# Building with OpenAgent UI

These are the shared primitives from the OpenAgent chat app (React, styled with
Tailwind over a CSS-variable token palette). Import the components from the
bundle; style your own layout with the design system's tokens so it matches.

## Theme & setup

**No provider component is required.** The design system is driven entirely by
**CSS custom properties** defined in `styles.css` (which imports
`_ds_bundle.css`).

- The **default theme is dark** (`:root`) — the app's real default look.
- **Light mode**: add `class="light"` to the root `<html>` element; every token
  flips to the light palette (`:root.light`). To theme only one region instead
  of the whole page, wrap it in `class="ds-light"` (or `class="ds-dark"` for a
  dark island) — both classes set the full palette, surface color, and Inter
  font on their subtree.
- **Inter** ships with the bundle and is the default sans-serif.

## Styling idiom — use the tokens

Color everything through the semantic tokens as `rgb(var(--color-NAME))`, so it
adapts to the theme automatically. **All of these are defined and safe to use:**

`main`, `sidebar`, `composer`, `user-bubble`, `assistant-bubble`, `hover`,
`border`, `text-primary`, `text-secondary`, `accent`, `accent-hover`,
`code-bg`, `code-header`, `danger`

Example: `style={{ background: "rgb(var(--color-main))", color: "rgb(var(--color-text-primary))", borderColor: "rgb(var(--color-border))" }}`.

The bundle also ships a **scoped** set of matching Tailwind classes — the ones
the components use, **not all of Tailwind**. These specific ones are present and
convenient: `bg-main`, `bg-sidebar`, `bg-user-bubble`, `bg-hover`,
`bg-text-primary`, `text-text-primary`, `text-text-secondary`, `text-danger`,
`text-main`, `border-border`. For anything beyond that list (arbitrary spacing,
grid, or other color utilities), **use inline styles or the `var(--color-*)`
tokens directly** — don't assume an unlisted utility class (`grid-cols-3`,
`bg-accent`, `p-6`, …) is in the shipped stylesheet.

## Where the truth lives

- `styles.css` and the `_ds_bundle.css` it imports — the token definitions,
  light/dark palettes, and component styles. Read these before styling.
- Per component: `<Name>.d.ts` (the exact props) and `<Name>.prompt.md` (usage).

## Example

```tsx
import { Button } from "openagent";

// Components for the controls; DS tokens for your own layout glue.
<div style={{
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 12, padding: 16, borderRadius: 14,
  background: "rgb(var(--color-user-bubble))",
  color: "rgb(var(--color-text-primary))",
}}>
  <span>Delete this conversation?</span>
  <div style={{ display: "flex", gap: 8 }}>
    <Button variant="ghost" size="sm">Cancel</Button>
    <Button variant="primary" size="sm">Delete</Button>
  </div>
</div>
```

Notes on the API: `Button` is pill-shaped (`variant`:
primary/secondary/ghost/outline, `size`: sm/md/lg, `loading`). `IconButton`
requires a `label` and an icon child (lucide-react icons work well). `Modal` and
`Dropdown` are controlled (`open` / render-prop). Always check each component's
`.d.ts` for the full prop list.
