import { useState } from "react";
import { useCallTool, useFiles, useHostContext, useOpenExternal, useToolContext, type ViewConfig } from "mcp-use/react";
import { Studio } from "../slide-studio/view.js";
import type { Deck } from "../slide-studio/schema.js";
export const viewConfig = {
  autoResize: true,
  displayModes: ["inline", "fullscreen"],
  preferredDisplayMode: "inline",
} satisfies ViewConfig;
export default function Preview() {
  const view = useToolContext<"create-deck">();
  const opener = useCallTool("open-slides");
  const files = useFiles();
  const openExternal = useOpenExternal();
  const { hostCapabilities } = useHostContext();
  const [loaded, setLoaded] = useState<Deck | null>(null);
  const [kept, setKept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloadNotice, setDownloadNotice] = useState("");
  if (view.status === "pending") return <div className="sc-loading" role="status">Preparing your new presentation…</div>;
  if (view.status === "error") return <div className="sc-loading" role="alert">{view.error.message}</div>;
  const output = view.toolOutput;
  if (loaded?.id === output.deck.id) return <Studio initial={loaded} />;
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function download() {
    const text = JSON.stringify(output.deck, null, 2);
    if (files.isSupported && hostCapabilities?.openLinks) {
      const ref = await files.upload(new File([text], output.jsonFilename, {type: "application/json"}));
      const {downloadUrl} = await files.getDownloadUrl(ref);
      await openExternal({url: downloadUrl});
    } else {
      const url = URL.createObjectURL(new Blob([text], {type: "application/json"}));
      const a = document.createElement("a"); a.href = url; a.download = output.jsonFilename; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    setDownloadNotice("JSON download requested. If downloads are blocked, copy the JSON below and save it as a .deck.json file.");
  }
  return <section className="sc-loading" aria-label="New presentation ready">
    <h2>{output.deck.title}</h2>
    <p>{output.deck.slides.length} slides ready. Your current presentation has not been replaced.</p>
    <p>{output.savedToAccount
      ? "A JSON copy is saved to your account. You can also download it below."
      : "A JSON copy is ready to download. Download it to keep a permanent copy."}</p>
    <p>{kept ? "Kept for later. You can still load it below when you are ready." : "Would you like to load this presentation now?"}</p>
    <button disabled={busy} onClick={() => void run(async () => {
      const result = await opener.callTool({deck: output.deck});
      setLoaded(result.structuredContent.deck);
    })}>Load now</button>
    <button disabled={busy || kept} onClick={() => setKept(true)}>Keep for later</button>
    <button disabled={busy} onClick={() => void run(download)}>Download JSON</button>
    <details><summary>Show JSON backup</summary><textarea readOnly aria-label="New presentation JSON" value={JSON.stringify(output.deck, null, 2)} /></details>
    {downloadNotice && <p role="status">{downloadNotice}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
