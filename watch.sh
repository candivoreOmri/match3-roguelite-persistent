#!/bin/sh
# Auto-sync loop for hands-on art editing: keeps the preview serve dir in
# step with src/ every 2 seconds. Leave it running in a terminal, save your
# PNG, then just refresh the browser (asset URLs are cache-busted per load).
#   sh watch.sh
cd "$(dirname "$0")"
echo "watching — save art, refresh browser (Ctrl+C to stop)"
while true; do
  sh sync.sh >/dev/null
  sleep 2
done
