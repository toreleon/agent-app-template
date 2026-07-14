# design-sync notes — openagent ui/ primitives

## What this syncs

This repo is a **Next.js chat app** (`openagent`, `"private": true`), not a
published component library. There is no `dist/`, no package entry points, and
no Storybook. The sync targets the seven shared primitives in
[`src/components/ui/`](../src/components/ui/): **Button, Dropdown, DropdownItem,
IconButton, Modal, Spinner, Tooltip**. Claude Design project:
`a07e062a-37bb-42ec-9db3-771a3412a624` ("OpenAgent Design System").

## Off-script build recipe (why the config looks unusual)

Because there's no dist, this runs the **package shape in synth-entry mode**, with
a few hand-built pieces:

- **Barrel entry** — `.design-sync/.cache/ds-barrel.tsx` re-exports the 7
  components. It is passed as `--entry` so the converter's `PKG_DIR` walk-up
  lands on the repo root (with `--node-modules ./node_modules` alone, `PKG_DIR`
  resolves to the non-existent `node_modules/openagent` and the build crashes
  reading its package.json). The barrel lives in `.cache/` (gitignored) and is
  regenerated content — **if you add/remove a ui/ component, update the barrel,
  `componentSrcMap`, and `dtsPropsFor` together.**
- **`componentSrcMap`** enumerates the 7 (synth discovery is bypassed once a real
  `--entry` is given, so the map is what defines the component set).
- **`dtsPropsFor`** hand-writes every `<Name>Props` body. There is no shipped
  `.d.ts`, so auto-extraction collapses to `{[key: string]: unknown}`. The
  hand-written contracts are curated (DS-specific props + common React/HTML
  props) rather than dumping all inherited `ButtonHTMLAttributes`. **These are
  hand-maintained — if a component's source props change, update `dtsPropsFor`
  to match; nothing auto-syncs them.**

## CSS (Tailwind) — must regenerate before every build

The components style via Tailwind utility classes over a CSS-var token palette.
`cfg.cssEntry` points at a **generated** file, so run this before
`package-build.mjs` / the driver:

```sh
bash .design-sync/build-css.sh
```

It (1) compiles the app's real Tailwind theme scoped to `src/components/ui/**`
plus `.design-sync/previews/**` → `.design-sync/.cache/ds-compiled.css`, then
(2) appends `.design-sync/ds-theme-scopes.css`. `cfg.buildCmd` is set to this so
re-sync re-runs it.

- `.design-sync/ds-tailwind.config.ts` reuses `tailwind.config.ts` but narrows
  `content` to the primitives + previews.
- `.design-sync/ds-theme-scopes.css` re-exposes the full **dark** (`:root`) and
  **light** (`:root.light`) palettes as ordinary `.ds-dark` / `.ds-light`
  classes whose custom properties cascade to any subtree. The app's light theme
  is normally reachable only from `:root.light` (the `light` class on `<html>`);
  these class wrappers let a single preview card show a component on **both**
  surfaces.

## Fonts

`[FONT_MISSING] Inter` was resolved by copying **Inter latin 400 + 600** woff2
(vendored under `node_modules/prisma/build/public/assets/`) into
`.design-sync/fonts/` (committed) and shipping them via `cfg.extraFonts`
(`.design-sync/fonts/inter.css`). The real app loads Inter through `next/font`
at runtime; this ships it statically so designs render in real Inter. Weight 500
(`font-medium`) font-matches down to 400 (no 500 file) — acceptable.

## Preview conventions

- Import components from `"openagent"` (remapped to `window.OpenAgentUI`).
- Each PascalCase function-component export = one card cell.
- Layout uses **inline styles** (not Tailwind classes) + `className="ds-dark"` /
  `"ds-light"` theme wrappers. This decouples preview authoring from CSS
  regeneration — the components' own classes are all already compiled, so a new
  preview never needs a CSS rebuild (subagents can safely `preview-rebuild`).
- lucide-react icons are used as real children (IconButton, Tooltip, menus) and
  bundle into the preview cleanly.

## Known render considerations (triaged, benign)

- **Modal** — shown **dark-only** in a single full-card cell
  (`cfg.overrides.Modal`). Its `fixed inset-0` overlay can't tile two themes side
  by side. The preview wraps it in a `transform: translateZ(0)` box so the fixed
  overlay is contained by the card (else the title clips off the top and the
  cell reports height 0 → `[RENDER_THIN]`).
- **Tooltip** — the tooltip bubble is **hover/focus-only** and can't render in a
  static screenshot. The card shows the real wrapped controls + a caption.
- **Dropdown** — the menu is **click-gated** (internal state, no `open` prop), so
  the card shows the trigger + a caption; **DropdownItem**'s card carries the
  menu visual.

## Known render warns

None currently — validate exits clean with 0 warnings. (Historically
`[FONT_MISSING] Inter` and `[RENDER_BLANK] Spinner`; both resolved — Inter
shipped, Spinner authored.)

## Re-sync risks (what can silently go stale)

- **Hand-maintained surfaces**: the barrel, `componentSrcMap`, and `dtsPropsFor`
  do not auto-track `src/components/ui/`. Adding a component, renaming one, or
  changing props requires editing all three. A prop change in source with no
  `dtsPropsFor` edit → the uploaded contract silently drifts from the code.
- **cssEntry is generated**: always `bash .design-sync/build-css.sh` before the
  build, or the bundle ships stale/empty component CSS.
- **Inter**: now committed under `.design-sync/fonts/` (independent of the
  prisma version), so this is stable — but the source is prisma's vendored copy,
  not an upstream Inter release.
- **Theme scopes**: `.ds-dark` / `.ds-light` duplicate the palette values from
  `src/app/globals.css`. If the app's token values change, update
  `.design-sync/ds-theme-scopes.css` to match (the compiled cssEntry picks up
  globals.css automatically, but the class-scoped duplicates don't).
- **Not a converter-native path**: this depends on the barrel/synth-entry trick.
  If the design-sync converter changes how synth-entry or `--entry` PKG_DIR
  resolution works, re-verify the build still lands `PKG_DIR` on the repo root.
