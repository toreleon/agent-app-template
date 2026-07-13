// Authored preview for IconButton. Uses the app's real icon library
// (lucide-react) as children, on both DS themes.
import { IconButton } from "openagent";
import { Search, Settings, Trash2, Plus, Copy, Pencil } from "lucide-react";

const panel = {
  flex: "1 1 240px",
  padding: 22,
  borderRadius: 14,
  border: "1px solid rgba(128,128,128,0.22)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
};
const tag = { fontSize: 10, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" as const, opacity: 0.45 };
const row = { display: "flex", flexWrap: "wrap" as const, gap: 8, alignItems: "center" };
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

export const Variants = () => (
  <Both>
    <div style={row}>
      <IconButton label="Search"><Search size={18} /></IconButton>
      <IconButton label="Copy"><Copy size={18} /></IconButton>
      <IconButton label="Settings" active><Settings size={18} /></IconButton>
      <IconButton label="Delete" disabled><Trash2 size={18} /></IconButton>
    </div>
  </Both>
);

export const Sizes = () => (
  <Both>
    <div style={row}>
      <IconButton label="Edit" size="sm"><Pencil size={15} /></IconButton>
      <IconButton label="Edit" size="md"><Pencil size={18} /></IconButton>
      <IconButton label="Edit" size="lg"><Pencil size={20} /></IconButton>
      <IconButton label="Add" size="lg"><Plus size={20} /></IconButton>
    </div>
  </Both>
);
