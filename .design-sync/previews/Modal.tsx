// Authored preview for Modal. Modal renders a fixed full-screen overlay, so it
// gets a single full-card cell (cfg.overrides.Modal). The fixed overlay can't
// tile two themes side by side, so it's shown in the app-default dark theme
// (noted in NOTES.md). The .ds-dark wrapper is the overlay's DOM parent, so the
// DS tokens still cascade into the fixed layer.
import { Modal, Button } from "openagent";

export const Standard = () => (
  // `transform` makes this div the containing block for Modal's `fixed inset-0`
  // overlay, so it centers inside the card instead of the capture viewport
  // (which clipped the title) and the cell reports a real height.
  <div
    className="ds-dark"
    style={{ position: "relative", height: 440, transform: "translateZ(0)", overflow: "hidden", borderRadius: 14 }}
  >
    <Modal open onClose={() => {}} title="Delete conversation?">
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        <p style={{ margin: 0, color: "rgb(161 161 170)", fontSize: 14, lineHeight: 1.6 }}>
          This will permanently remove <strong style={{ color: "rgb(236 236 236)" }}>“Weekend trip planning”</strong> and
          all of its messages. This action can’t be undone.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Button variant="ghost" size="sm">Cancel</Button>
          <Button variant="primary" size="sm">Delete</Button>
        </div>
      </div>
    </Modal>
  </div>
);
