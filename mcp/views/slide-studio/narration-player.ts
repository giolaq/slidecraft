export type PlaybackClip = {
  slideId: string;
  status: string;
  assetId?: string;
  durationMs?: number;
};
export type PlaybackState =
  "manual" | "loading" | "playing" | "paused" | "ended" | "blocked" | "error";
export interface AudioPort {
  src: string;
  volume: number;
  currentTime: number;
  onended: ((event: Event) => unknown) | null;
  onerror: OnErrorEventHandler;
  play(): Promise<void>;
  pause(): void;
}
export interface PlayerHost {
  audio(): AudioPort;
  load(assetId: string, signal: AbortSignal): Promise<string>;
  release(url: string): void;
  select(id: string): void;
  ready(id: string, signal: AbortSignal): Promise<void>;
  changed(state: PlaybackState, message: string): void;
}
// Owns audio outside authored/speaker frames. Every async callback belongs to a run epoch.
export class NarrationPlayer {
  index: number;
  state: PlaybackState = "manual";
  private audio?: AudioPort;
  private url?: string;
  private epoch = 0;
  private abort?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private started = 0;
  private remaining?: number;
  private volume = 1;
  constructor(
    private clips: PlaybackClip[],
    index: number,
    private host: PlayerHost,
  ) {
    this.index = index;
  }
  private stateChanged(state: PlaybackState, message = "") {
    this.state = state;
    this.host.changed(state, message);
  }
  private invalidate() {
    this.epoch++;
    this.abort?.abort();
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
    }
  }
  private clearClip() {
    this.audio = undefined;
    if (this.url) this.host.release(this.url);
    this.url = undefined;
    this.remaining = undefined;
  }
  async start(index = this.index, reset = false) {
    if (!this.clips[index]) return;
    const oldIndex = this.index;
    this.invalidate();
    const epoch = this.epoch;
    if (reset || oldIndex !== index) this.clearClip();
    this.index = index;
    const clip = this.clips[index];
    this.host.select(clip.slideId);
    this.stateChanged("loading");
    const abort = new AbortController();
    this.abort = abort;
    try {
      await this.host.ready(clip.slideId, abort.signal);
      if (epoch !== this.epoch) return;
      if (clip.status === "silent") {
        this.remaining ??= clip.durationMs ?? 5000;
        this.started = Date.now();
        this.stateChanged("playing");
        this.timer = setTimeout(() => {
          if (epoch === this.epoch) this.advance();
        }, this.remaining);
        return;
      }
      if (clip.status !== "ready" || !clip.assetId)
        throw new Error(
          "This slide needs narration. Return to the studio to generate it.",
        );
      if (!this.audio) {
        const url = await this.host.load(clip.assetId, abort.signal);
        if (epoch !== this.epoch) {
          this.host.release(url);
          return;
        }
        this.url = url;
        this.audio = this.host.audio();
        this.audio.src = url;
      }
      const audio = this.audio;
      audio.volume = this.volume;
      audio.onended = () => {
        if (epoch === this.epoch && this.state === "playing") this.advance();
      };
      audio.onerror = () => {
        if (epoch === this.epoch) {
          this.invalidate();
          this.clearClip();
          this.stateChanged(
            "error",
            "Audio could not be played. Retry audio or navigate manually.",
          );
        }
      };
      await audio.play();
      if (epoch !== this.epoch) return;
      this.stateChanged("playing");
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.stateChanged(
        (e as Error).name === "NotAllowedError" ? "blocked" : "error",
        (e as Error).name === "NotAllowedError"
          ? "Press Resume audio to allow sound."
          : e instanceof Error
            ? e.message
            : "Audio failed. Retry playback.",
      );
    }
  }
  private advance() {
    if (this.index === this.clips.length - 1) {
      this.invalidate();
      this.clearClip();
      this.stateChanged("ended", "End of presentation");
    } else void this.start(this.index + 1, true);
  }
  pause(message = "Paused") {
    if (
      this.state === "playing" &&
      this.clips[this.index]?.status === "silent" &&
      this.remaining !== undefined
    )
      this.remaining = Math.max(
        0,
        this.remaining - (Date.now() - this.started),
      );
    this.invalidate();
    this.stateChanged("paused", message);
  }
  manual(index: number) {
    if (!this.clips[index]) return;
    this.invalidate();
    this.clearClip();
    this.index = index;
    this.host.select(this.clips[index].slideId);
    this.stateChanged(
      "paused",
      "Navigation paused narration. Resume when ready.",
    );
  }
  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.audio) this.audio.volume = this.volume;
  }
  stop() {
    this.invalidate();
    this.clearClip();
    this.stateChanged("manual");
  }
}
