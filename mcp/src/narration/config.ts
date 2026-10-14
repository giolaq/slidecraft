import { oauthAuth0Provider } from "mcp-use/oauth/auth0";
import { FileStore, PostgresStore } from "./store.js";
import { FileAssets, S3Assets } from "./assets.js";
import { Vault } from "./crypto.js";
import { ElevenLabs, diagnoseElevenLabsNetwork } from "./provider.js";
import { NarrationService } from "./service.js";
const required = (key: string) => {
  const v = process.env[key];
  if (!v) throw new Error(`Narration requires ${key}.`);
  return v;
};
export const enabled = process.env.NARRATION_ENABLED === "true";
export const config = enabled
  ? {
      origin: required("NARRATION_PUBLIC_URL").replace(/\/$/, ""),
      issuer:
        "https://" +
        required("AUTH0_DOMAIN")
          .replace(/^https:\/\//, "")
          .replace(/\/$/, "") +
        "/",
      audience: required("AUTH0_AUDIENCE"),
      clientId: required("AUTH0_CLIENT_ID"),
      clientSecret: required("AUTH0_CLIENT_SECRET"),
    }
  : null;
if (config && new URL(config.origin).protocol !== "https:")
  throw new Error("Narration public URL must use HTTPS.");
export const oauth = config
  ? oauthAuth0Provider({ domain: config.issuer, resource: config.audience })
  : undefined;
function createService() {
  const vault = new Vault(
    Buffer.from(required("NARRATION_ENCRYPTION_KEY"), "base64"),
  );
  const local = process.env.NARRATION_DEV_DIR;
  if (local && process.env.NODE_ENV === "production")
    throw new Error(
      "Production narration requires Postgres and private S3 storage.",
    );
  const store = local
    ? new FileStore(local + "/state.json")
    : new PostgresStore(required("DATABASE_URL"));
  const assets = local
    ? new FileAssets(local + "/audio")
    : new S3Assets(
        required("NARRATION_S3_BUCKET"),
        process.env.NARRATION_S3_ENDPOINT,
        process.env.AWS_REGION,
      );
  return new NarrationService(store, assets, new ElevenLabs(), vault);
}
// The build imports this module to discover views. Keep OAuth/CSP configuration,
// but do not open database connections or start background jobs during discovery.
export const narration =
  enabled && process.env.SLIDECRAFT_BUILD_ONLY !== "true" ? createService() : null;
if (narration && process.env.NARRATION_PROVIDER_DIAGNOSTICS === "true")
  void diagnoseElevenLabsNetwork();
export function requireNarration() {
  if (!narration)
    throw new Error(
      "Narration is not configured on this server. Ask the administrator to configure identity, database and audio storage.",
    );
  return narration;
}
export function requireOwner(auth: unknown): string {
  const a = auth as { user?: { id?: unknown } } | undefined;
  if (!config || typeof a?.user?.id !== "string" || !a.user.id)
    throw new Error("Sign in to Slidecraft to use your narration account.");
  return config.issuer + "|" + a.user.id;
}
// The service process acts as a worker. Leases and PostgreSQL locking allow replicas.
// Keep at least one instance running; queued work survives restarts and closed widgets.
if (narration) {
  let busy = false;
  let nextCleanup = 0;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      if (Date.now() > nextCleanup) {
        await narration.cleanup();
        nextCleanup = Date.now() + 3600000;
      }
      await narration.tick();
    })()
      .catch(() =>
        console.error("Narration worker failed; pending jobs remain durable."),
      )
      .finally(() => {
        busy = false;
      });
  }, 2000);
  timer.unref();
}
