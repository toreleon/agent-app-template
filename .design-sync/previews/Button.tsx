// Authored preview for Button. Each PascalCase export renders one card cell.
// Components import from the bundle ("openagent" → window.OpenAgentUI). Layout
// uses inline styles; the .ds-dark / .ds-light wrappers supply the DS tokens +
// surface so every cell shows the component on both real app themes.
import { Button } from "openagent";

const panel = (theme: "dark" | "light") => ({
  flex: "1 1 240px",
  padding: 20,
  borderRadius: 14,
  border: "1px solid rgba(128,128,128,0.22)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 14,
});
const tag = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.09em",
  textTransform: "uppercase" as const,
  opacity: 0.45,
};
const row = { display: "flex", flexWrap: "wrap" as const, gap: 10, alignItems: "center" };
const both = { display: "flex", flexWrap: "wrap" as const, gap: 14 };

function Both({ children }: { children: React.ReactNode }) {
  return (
    <div style={both}>
      <div className="ds-dark" style={panel("dark")}>
        <span style={tag}>Dark</span>
        {children}
      </div>
      <div className="ds-light" style={panel("light")}>
        <span style={tag}>Light</span>
        {children}
      </div>
    </div>
  );
}

export const Variants = () => (
  <Both>
    <div style={row}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="outline">Outline</Button>
    </div>
  </Both>
);

export const Sizes = () => (
  <Both>
    <div style={row}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  </Both>
);

export const States = () => (
  <Both>
    <div style={row}>
      <Button loading>Saving…</Button>
      <Button variant="secondary" disabled>
        Disabled
      </Button>
      <Button variant="outline">Enabled</Button>
    </div>
  </Both>
);
