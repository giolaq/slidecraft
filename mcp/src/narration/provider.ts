import { parseBuffer } from "music-metadata";
import { FORMAT } from "./model.js";
import type { Deck } from "../../views/slide-studio/schema.js";
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public uncertain = false,
  ) {
    super(message);
  }
}
export interface Voice {
  id: string;
  name: string;
}
export interface Model {
  id: string;
  name: string;
  limit: number;
}
export interface Provider {
  catalog(key: string): Promise<{ voices: Voice[]; models: Model[] }>;
  generate(
    key: string,
    text: string,
    settings: NonNullable<Deck["narration"]>,
  ): Promise<{ bytes: Uint8Array; durationMs: number }>;
}
export class ElevenLabs implements Provider {
  private async request(path: string, key: string, body?: unknown) {
    let response: Response;
    try {
      response = await fetch("https://api.elevenlabs.io" + path, {
        method: body ? "POST" : "GET",
        headers: {
          "xi-api-key": key,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120000),
      });
    } catch {
      throw new ProviderError(
        body
          ? "Generation outcome unknown. Check ElevenLabs usage before explicitly retrying."
          : "ElevenLabs is unreachable.",
        false,
        !!body,
      );
    }
    if (!response.ok) {
      // Never expose provider bodies: they may echo scripts or account details.
      const status = response.status;
      throw new ProviderError(
        status === 429
          ? "ElevenLabs rate limit or credit limit reached."
          : status === 401 || status === 403
            ? body
              ? "ElevenLabs rejected the key. Enable Text to Speech access or reconnect with a valid restricted key."
              : path.startsWith("/v2/voices")
                ? "ElevenLabs rejected the key while listing voices. Enable Voices read access and check that the key is valid."
                : "ElevenLabs rejected the key while listing models. Enable Models read access and check that the key is valid."
            : `ElevenLabs request failed (${status}).`,
        status === 429,
        !(!body || status < 500),
      );
    }
    return response;
  }
  async catalog(key: string) {
    const voices: Voice[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const data = (await (
        await this.request(
          "/v2/voices?page_size=100" +
            (cursor ? "&next_page_token=" + encodeURIComponent(cursor) : ""),
          key,
        )
      ).json()) as {
        voices: { voice_id: string; name: string }[];
        has_more: boolean;
        next_page_token?: string;
      };
      voices.push(
        ...data.voices.map((v) => ({ id: v.voice_id, name: v.name })),
      );
      if (!data.has_more) break;
      if (!data.next_page_token)
        throw new Error("Incomplete ElevenLabs voice catalog.");
      cursor = data.next_page_token;
    }
    const models = (await (await this.request("/v1/models", key)).json()) as {
      model_id: string;
      name: string;
      can_do_text_to_speech: boolean;
      max_characters_request_free_user?: number;
      max_characters_request_subscribed_user?: number;
    }[];
    return {
      voices,
      models: models
        .filter((m) => m.can_do_text_to_speech)
        .map((m) => ({
          id: m.model_id,
          name: m.name,
          limit:
            m.max_characters_request_free_user ??
            m.max_characters_request_subscribed_user ??
            10000,
        })),
    };
  }
  async generate(
    key: string,
    text: string,
    settings: NonNullable<Deck["narration"]>,
  ) {
    const response = await this.request(
      `/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}?output_format=${FORMAT}`,
      key,
      { text, model_id: settings.modelId, voice_settings: settings.settings },
    );
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError("Empty audio response.", false, true);
    const parts: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32 * 1024 * 1024) {
        await reader.cancel();
        throw new ProviderError(
          "Audio exceeded the storage limit.",
          false,
          true,
        );
      }
      parts.push(value);
    }
    const bytes = Buffer.concat(parts);
    try {
      const metadata = await parseBuffer(
        bytes,
        { mimeType: "audio/mpeg" },
        { duration: true },
      );
      const duration = metadata.format.duration;
      if (!duration || !Number.isFinite(duration) || duration <= 0)
        throw new Error();
      return { bytes, durationMs: Math.ceil(duration * 1000) };
    } catch {
      throw new ProviderError(
        "ElevenLabs returned invalid audio; check usage before retrying.",
        false,
        true,
      );
    }
  }
}
