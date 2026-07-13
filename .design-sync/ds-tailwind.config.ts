// Scoped Tailwind config for the design-sync import. Reuses the app's real
// theme (semantic CSS-var palette, fonts, keyframes) but restricts `content`
// to the ui/ primitives + authored previews so the compiled CSS carries only
// the classes those components use.
import base from "../tailwind.config";
import type { Config } from "tailwindcss";

const config: Config = {
  ...base,
  content: [
    "./src/components/ui/**/*.{ts,tsx}",
    "./.design-sync/previews/**/*.{ts,tsx}",
  ],
};

export default config;
