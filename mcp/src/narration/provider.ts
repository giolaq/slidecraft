import { parseBuffer } from "music-metadata";
import { FORMAT } from "./model.js";
import type { Deck } from "../../views/slide-studio/schema.js";
// Only recognized machine codes may leave the provider boundary. Upstream
// messages and unknown values may contain credentials or account information.
const safeErrorCodes = new Set([
  "invalid_api_key", "invalid_api_key_type", "invalid_authorization_header",
  "needs_authorization", "missing_permissions", "missing_permission",
  "insufficient_permissions", "invalid_parameters", "invalid_parameter",
  "invalid_request", "invalid_request_body", "validation_error",
  "invalid_page_size", "invalid_next_page_token", "invalid_pagination_token",
  "workspace_not_found", "invalid_workspace", "invalid_service_account",
  "quota_exceeded", "rate_limit_exceeded", "too_many_concurrent_requests",
  "system_busy", "detected_unusual_activity", "unusual_activity",
  "ip_not_allowed", "ip_address_not_allowed", "unsupported_region",
  "wrong_region", "data_residency_error", "voice_not_found", "model_not_found",
]);
function errorCode(value: unknown, key: string): string | undefined {
  if (typeof value !== "string") return;
  if (safeErrorCodes.has(value)) return value;
  // Permit only bounded machine identifiers, never messages, credential-shaped
  // values, or any part of the supplied key. This covers new provider codes.
  if (value.length <= 64 && /^[a-z]+(?:_[a-z]+)+$/.test(value) &&
      !/^(sk|pk|rk|key|secret|token|user|workspace|account)_/.test(value) &&
      !key.toLowerCase().includes(value)) return value;
}
function responseCode(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== "object") return;
  const d = data as { detail?: { status?: unknown; code?: unknown } | string; code?: unknown; error?: { code?: unknown } };
  const detail = typeof d.detail === "object" ? d.detail : undefined;
  return errorCode(detail?.status ?? detail?.code ?? d.error?.code ?? d.code ?? d.detail, key);
}
function responseKind(response: Response): string {
  const type = response.headers.get("content-type") ?? "";
  return type.includes("json") ? "JSON" : type.includes("html") ? "HTML" : "non-JSON";
}
// Opt-in startup check: no real credentials, no paid endpoints, no raw bodies.
export async function diagnoseElevenLabsNetwork() {
  console.info("ElevenLabs network diagnostic: " + JSON.stringify({
    httpsProxyConfigured: !!(process.env.HTTPS_PROXY || process.env.https_proxy),
    httpProxyConfigured: !!(process.env.HTTP_PROXY || process.env.http_proxy),
    nodeEnvProxyEnabled: process.env.NODE_USE_ENV_PROXY === "1",
  }));
  for (const explicitHeaders of [false, true]) {
    try {
      const key = "slidecraft-diagnostic-invalid-key";
      const response = await fetch("https://api.elevenlabs.io/v2/voices", {
        headers: { "xi-api-key": key, ...(explicitHeaders ? { Accept: "application/json", "User-Agent": "Slidecraft/diagnostic" } : {}) },
        signal: AbortSignal.timeout(15000),
      });
      const kind = responseKind(response);
      const data = await response.json().catch(() => null);
      console.info("ElevenLabs network diagnostic: " + JSON.stringify({
        explicitHeaders, status: response.status, kind, code: responseCode(data, key) ?? "unclassified",
      }));
    } catch {
      console.info("ElevenLabs network diagnostic: request unreachable.");
    }
  }
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public uncertain = false,
    public httpStatus?: number,
    public code?: string,
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
      const status = response.status;
      const kind = responseKind(response);
      const detail: unknown = await response.json().catch(() => null);
      const code = responseCode(detail, key);
      const isVoices = /^\/v[12]\/voices(?:[/?]|$)/.test(path);
      const operation = body ? "speech generation" : isVoices ? "voice listing" : "model listing";
      const diagnostic = `ElevenLabs ${operation} failed (HTTP ${status}${code ? `; ${code}` : kind !== "JSON" ? `; ${kind} response` : ""}).`;
      const permissions = code === "missing_permissions" || code === "missing_permission" || code === "insufficient_permissions";
      throw new ProviderError(
        status === 429
          ? diagnostic + " Rate limit or credit limit reached."
          : status === 401 || status === 403 || permissions
            ? body
              ? diagnostic + " Enable Text to Speech access or reconnect with a valid restricted key."
              : isVoices
                ? diagnostic + " Enable Voices read access and check that the key is valid."
                : diagnostic + " Enable Models read access and check that the key is valid."
            : code === "workspace_not_found" || code === "invalid_workspace"
              ? diagnostic + " Create the key in the ElevenLabs workspace you want to use."
              : diagnostic,
        status === 429,
        !(!body || status < 500),
        status,
        code,
      );
    }
    return response;
  }
  async catalog(key: string) {
    const voices: Voice[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      let response: Response;
      try {
        // Use the provider's documented default page size.
        response = await this.request(
          "/v2/voices" + (cursor ? "?next_page_token=" + encodeURIComponent(cursor) : ""), key,
        );
      } catch (error) {
        // Compatibility with accounts/gateways that reject v2 search. This is
        // one read-only fallback, never a retry of a paid generation request.
        // Known credential, permission, quota and policy failures are preserved.
        if (page !== 0 || !(error instanceof ProviderError) || error.httpStatus !== 400 || error.code)
          throw error;
        response = await this.request("/v1/voices", key);
      }
      const data = (await response.json()) as {
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
      if (page === 99) throw new ProviderError("ElevenLabs voice catalog exceeded the pagination limit.");
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
