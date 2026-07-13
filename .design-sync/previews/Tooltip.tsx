// Authored preview for Tooltip. The tooltip bubble is revealed on hover/focus,
// which a static screenshot can't trigger, so the card shows the real wrapped
// controls plus a caption describing the behavior (noted in NOTES.md).
import { Tooltip, IconButton, Button } from "openagent";
import { Info, Settings, Share2 } from "lucide-react";

const panel = {
  flex: "1 1 260px",
  padding: 22,
  borderRadius: 14,
  border: "1px solid rgba(128,128,128,0.22)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 14,
};
const tag = { fontSize: 10, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" as const, opacity: 0.45 };
const caption = { fontSize: 12.5, lineHeight: 1.5, opacity: 0.7 };
const row = { display: "flex", flexWrap: "wrap" as const, gap: 10, alignItems: "center" };
const both = { display: "flex", flexWrap: "wrap" as const, gap: 14 };

function Both({ children }: { children: React.ReactNode }) {
  return (
    <div style={both}>
      <div className="ds-dark" style={panel}>
        <span style={tag}>Dark</span>
        {children}
      </div>
      <div className="ds-light" style={panel}>
        <span style={tag}>Light</span>
        {children}
      </div>
    </div>
  );
}

export const OnControls = () => (
  <Both>
    <span style={caption}>Hover or focus a control to reveal its tooltip label.</span>
    <div style={row}>
      <Tooltip label="More info">
        <IconButton label="Info"><Info size={18} /></IconButton>
      </Tooltip>
      <Tooltip label="Settings" side="bottom">
        <IconButton label="Settings"><Settings size={18} /></IconButton>
      </Tooltip>
      <Tooltip label="Share this chat">
        <Button variant="secondary" size="sm"><Share2 size={15} /> Share</Button>
      </Tooltip>
    </div>
  </Both>
);
