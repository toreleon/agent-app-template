// Authored preview for Dropdown. The menu opens on click (internal state) and
// can't be forced open in a static screenshot, so the card shows the real
// trigger + a caption; DropdownItem's card shows the menu contents.
import { Dropdown, DropdownItem, Button } from "openagent";
import { Pencil, Copy, Trash2 } from "lucide-react";

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

export const Trigger = () => (
  <Both>
    <span style={caption}>Click the trigger to open the menu.</span>
    <Dropdown trigger={<Button variant="secondary" size="sm">Actions ⌄</Button>}>
      {(close) => (
        <>
          <DropdownItem onClick={close}>
            <Pencil size={15} /> Rename
          </DropdownItem>
          <DropdownItem onClick={close}>
            <Copy size={15} /> Duplicate
          </DropdownItem>
          <DropdownItem danger onClick={close}>
            <Trash2 size={15} /> Delete
          </DropdownItem>
        </>
      )}
    </Dropdown>
  </Both>
);
