// Authored preview for Spinner. Renders on both DS themes; Spinner is
// `text-current`, so it inherits the surrounding text color.
import { Spinner } from "openagent";

const panel = {
  flex: "1 1 220px",
  padding: 24,
  borderRadius: 14,
  border: "1px solid rgba(128,128,128,0.22)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 18,
};
const tag = { fontSize: 10, fontWeight: 600, letterSpacing: "0.09em", textTransform: "uppercase" as const, opacity: 0.45 };
const row = { display: "flex", gap: 22, alignItems: "center" };
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

export const Sizes = () => (
  <Both>
    <div style={row}>
      <Spinner size={16} />
      <Spinner size={24} />
      <Spinner size={40} />
    </div>
  </Both>
);

export const OnAccent = () => (
  <Both>
    <div style={{ ...row, color: "rgb(16 163 127)" }}>
      <Spinner size={20} />
      <span style={{ fontSize: 14 }}>Loading…</span>
    </div>
  </Both>
);
