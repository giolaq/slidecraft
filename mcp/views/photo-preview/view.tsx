import { useToolContext, type ViewConfig } from "mcp-use/react";
import { Studio } from "../slide-studio/view.js";
export const viewConfig = {
  autoResize: true,
  displayModes: ["inline", "fullscreen"],
  preferredDisplayMode: "inline",
} satisfies ViewConfig;
export default function Preview() {
  const view = useToolContext<"add-photo">();
  if (view.status === "pending")
    return (
      <div className="sc-loading" role="status">
        Updating your presentation…
      </div>
    );
  if (view.status === "error")
    return (
      <div className="sc-loading" role="alert">
        {view.error.message}
      </div>
    );
  return (
    <Studio
      initial={view.toolOutput.deck}
      initialSelectedSlideId={view.toolOutput.selectedSlideId}
    />
  );
}
