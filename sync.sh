#!/bin/sh
# Copies src/ to the preview serve dir. The preview/browser sandbox cannot read
# ~/Desktop (macOS TCC), so the dev server serves this copy instead. Run after
# EVERY edit (or leave `sh watch.sh` running).
#
# ATOMIC: copies to a staging dir first and swaps only on success — a failed
# copy (e.g. a terminal without Desktop access) leaves the old copy serving
# instead of a half-empty directory.
#
#   http://localhost:8940/src/   the game (port may differ — autoPort)

set -e
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=/private/tmp/ascent-serve
STAGE=$(mktemp -d /private/tmp/ascent-stage.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT

cp -R "$SRC/src" "$STAGE/src"
if [ ! -f "$STAGE/src/app.js" ] || [ ! -f "$STAGE/src/vendor/react.min.js" ]; then
  echo "sync FAILED: copy incomplete — does this terminal have Desktop access?" >&2
  echo "(System Settings → Privacy & Security → Files and Folders)" >&2
  exit 1
fi

mkdir -p "$DEST"
rm -rf "$DEST/src.old"
[ -d "$DEST/src" ] && mv "$DEST/src" "$DEST/src.old"
mv "$STAGE/src" "$DEST/src"
rm -rf "$DEST/src.old"

echo "synced -> $DEST"
