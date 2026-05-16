#!/usr/bin/env bash
# Package the browser extension into a downloadable ZIP that the
# in-app onboarding modal can hand to the user.
#
# Runs automatically as a `prebuild` hook before `vite build`, so the
# fresh ZIP lands in `frontend/dist/downloads/mindshift-extension.zip`
# via Vite's `public/` copy. On localhost the file lives under
# `frontend/public/downloads/mindshift-extension.zip` so `npm run dev`
# can serve it too without an extra build step.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_ROOT/extension"
OUT_DIR="$REPO_ROOT/frontend/public/downloads"
OUT_FILE="$OUT_DIR/mindshift-extension.zip"
VERSION_FILE="$OUT_DIR/extension-version.json"

if [ ! -d "$EXT_DIR" ]; then
  # Railway's frontend Dockerfile copies only `frontend/` into the
  # build context, so `extension/` simply isn't visible there. That's
  # expected — the committed ZIP from the last local build is what
  # ships. Skip silently instead of failing the entire deploy.
  echo "[build-extension-zip] extension/ not found at $EXT_DIR — skipping (committed ZIP will be used)"
  exit 0
fi

# Read the extension's own version manifest so the onboarding modal
# can show "v0.14.2" alongside the download button.
VERSION="$(python3 -c "
import json, sys
with open('$EXT_DIR/manifest.json') as f:
    print(json.load(f).get('version', 'unknown'))
")"

mkdir -p "$OUT_DIR"

# Ditch any old artefact so a failed zip can't masquerade as fresh.
rm -f "$OUT_FILE"

# Bundle the extension. `cd` first so paths inside the zip are
# extension-relative (a user unzips and gets `manifest.json` at the
# top level, not `extension/manifest.json`).
(
  cd "$EXT_DIR"
  # Strip macOS resource forks + the README (extension users don't
  # need our developer notes shipped along).
  zip -rq "$OUT_FILE" . \
    -x "README.md" \
    -x "*.DS_Store" \
    -x "__MACOSX/*"
)

# Companion JSON the frontend can fetch to display the version.
cat > "$VERSION_FILE" <<EOF
{ "version": "$VERSION" }
EOF

SIZE_KB="$(du -k "$OUT_FILE" | awk '{print $1}')"
echo "[build-extension-zip] wrote $OUT_FILE ($SIZE_KB KB, v$VERSION)"
