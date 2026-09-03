#!/bin/sh
# ART REFRESH — the one command to run after adding or replacing art:
#   sh art-refresh.sh
# 1. regenerates placeholders for any slot that still lacks art (your files are
#    never touched — anything whose hash isn't in placeholders.sha1 is yours)
# 2. rewrites skin.json / tile-styles.json so every slot is mapped
# 3. syncs src/ to the preview server dir
# Then just refresh the browser (asset URLs are cache-busted per page load).
set -e
cd "$(dirname "$0")"

PY=""
for cand in python3 /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import PIL" >/dev/null 2>&1; then PY="$cand"; break; fi
done
if [ -z "$PY" ]; then
  echo "art-refresh: no python3 with Pillow (PIL) found." >&2
  echo "  fix: python3 -m pip install --user pillow   (then rerun)" >&2
  exit 1
fi

echo "→ regenerating placeholders (your art is protected by the ledger)…"
"$PY" tools/gen_placeholders.py 2>/dev/null
echo "→ syncing to the preview server…"
sh sync.sh
echo "✓ art refreshed — reload the browser (Cmd+R). Style guide: http://localhost:8940/src/assets/styleguide.html"
