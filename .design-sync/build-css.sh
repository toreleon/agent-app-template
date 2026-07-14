#!/usr/bin/env bash
# Regenerate the design-sync cssEntry: compile the app's Tailwind (scoped to the
# ui/ primitives + authored previews) then append the class-scoped theme
# wrappers used by the preview cards. Run before package-build.mjs.
set -euo pipefail
cd "$(dirname "$0")/.."
node_modules/.bin/tailwindcss \
  -c .design-sync/ds-tailwind.config.ts \
  -i src/app/globals.css \
  -o .design-sync/.cache/ds-compiled.css 2>/dev/null
cat .design-sync/ds-theme-scopes.css >> .design-sync/.cache/ds-compiled.css
echo "cssEntry rebuilt: $(wc -l < .design-sync/.cache/ds-compiled.css) lines"
