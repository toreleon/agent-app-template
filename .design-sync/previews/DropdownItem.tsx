// Authored preview for DropdownItem. Renders the real items inside the same
// menu container the Dropdown uses (bg-sidebar rounded card), on both themes.
import { DropdownItem } from "openagent";
import { Pencil, Copy, Share2, Trash2 } from "lucide-react";

const panel = {
  flex: "1 1 240px",
  padding: 22,
  borderRadius: 14,
  border: "1px solid rgba(128,128,128,0.22)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 14,
};
const tag = { fontSize: 10, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" as const, opacity: 0.45 };
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

export const Menu = () => (
  <Both>
    <div
      className="bg-sidebar border border-border rounded-xl p-1.5 shadow-2xl"
      style={{ minWidth: 190 }}
    >
      <DropdownItem>
        <Pencil size={15} /> Rename
      </DropdownItem>
      <DropdownItem active>
        <Copy size={15} /> Duplicate
      </DropdownItem>
      <DropdownItem>
        <Share2 size={15} /> Share
      </DropdownItem>
      <DropdownItem danger>
        <Trash2 size={15} /> Delete
      </DropdownItem>
    </div>
  </Both>
);
