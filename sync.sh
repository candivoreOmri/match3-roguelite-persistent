#!/bin/sh
# Copies src/ to the preview serve dir. The preview/browser sandbox cannot read
# ~/Desktop (macOS TCC), so the dev server serves this copy instead. Run after
# EVERY edit.
#
#   http://localhost:8940/src/   the game (port may differ — autoPort)

set -e
SRC=$(cd "$(dirname "$0")" && pwd)
DEST=/private/tmp/ascent-serve

rm -rf "$DEST/src"
mkdir -p "$DEST"
cp -R "$SRC/src" "$DEST/src"

echo "synced -> $DEST"
