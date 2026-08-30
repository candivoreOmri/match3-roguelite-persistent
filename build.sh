#!/bin/sh
# Regenerates the passphrase-gated playtest build (./index.html) from ./src.
#
#   M3_PASSPHRASE=<passphrase> sh build.sh
#
# index.html is a GENERATED file — never hand-edit it. All changes go in src/,
# then rerun this script and commit both together.
#
# The passphrase is deliberately NOT stored in this public repo; ask Omri for it.
set -e
cd "$(dirname "$0")"
SRC=src
PASSPHRASE="${M3_PASSPHRASE:?set M3_PASSPHRASE (ask Omri for the playtest passphrase)}"
ITER=200000
TITLE='Match-3 Roguelite — Ascent'
GATE_HEADING='🏔️ Match-3 Roguelite — Ascent'

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. plain self-contained game bundle
{
  echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
  echo "<title>$TITLE</title>"
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">'
  echo '<style>'
  cat "$SRC/styles.css"
  echo '</style></head><body>'
  echo '<div id="root"></div>'
  for f in "$SRC/vendor/react.min.js" "$SRC/vendor/react-dom.min.js" "$SRC/vendor/htm.min.js" "$SRC/shared/engine.js" "$SRC/shared/powerups.js" "$SRC/app.js"; do
    echo '<script>'
    cat "$f"
    echo '</script>'
  done
  echo '</body></html>'
} > "$TMP/plain.html"

# 2. encrypt (OpenSSL salted format: "Salted__" + 8-byte salt + ciphertext;
#    PBKDF2-SHA256 derives 32-byte key + 16-byte IV — mirrored by the loader)
openssl enc -aes-256-cbc -pbkdf2 -iter "$ITER" -salt -pass "pass:$PASSPHRASE" \
  -in "$TMP/plain.html" -out "$TMP/cipher.bin"
openssl base64 -A -in "$TMP/cipher.bin" -out "$TMP/cipher.b64"

# 3. compose the unlock page around the payload
{
  cat <<HEAD
<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>$TITLE</title>
<style>
body{background:#12141a;color:#e8eaf0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.gate{text-align:center;display:flex;flex-direction:column;gap:14px;padding:24px;max-width:300px;width:100%}
h1{font-size:24px;margin:0}
p{color:#9aa0b0;font-size:14px;margin:0}
input{font:inherit;color:#e8eaf0;background:#1c202b;border:1px solid #363c4e;border-radius:10px;padding:12px 14px;text-align:center}
button{font:inherit;font-weight:700;color:#fff;background:linear-gradient(135deg,#4f7cff,#7a4fff);border:none;border-radius:12px;padding:13px;cursor:pointer}
.err{color:#ff6a6a;font-size:13px;min-height:18px}
</style></head><body>
<div class="gate"><h1>$GATE_HEADING</h1><p>Enter the playtest passphrase</p>
<input id="pw" type="password" autocomplete="off" autofocus>
<button id="go">Unlock</button><div class="err" id="err"></div></div>
<script>
HEAD
  printf "const PAYLOAD='"
  cat "$TMP/cipher.b64"
  printf "';const ITER=%s;\n" "$ITER"
  cat <<'LOADER'
async function unlock(pw){
  const raw=Uint8Array.from(atob(PAYLOAD),ch=>ch.charCodeAt(0));
  const salt=raw.slice(8,16),ct=raw.slice(16);
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:ITER,hash:'SHA-256'},km,384));
  const key=await crypto.subtle.importKey('raw',bits.slice(0,32),'AES-CBC',false,['decrypt']);
  const pt=await crypto.subtle.decrypt({name:'AES-CBC',iv:bits.slice(32,48)},key,ct);
  return new TextDecoder().decode(pt);
}
async function go(){
  const pw=document.getElementById('pw').value.trim();
  if(!pw)return;
  document.getElementById('err').textContent='';
  try{
    const html=await unlock(pw);
    try{localStorage.setItem('m3_gate',pw);}catch(e){}
    document.open();document.write(html);document.close();
  }catch(e){
    try{localStorage.removeItem('m3_gate');}catch(err){}
    document.getElementById('err').textContent='Wrong passphrase';
  }
}
document.getElementById('go').onclick=go;
document.getElementById('pw').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
try{
  const saved=localStorage.getItem('m3_gate');
  if(saved){document.getElementById('pw').value=saved;go();}
}catch(e){}
</script></body></html>
LOADER
} > index.html

echo "regenerated index.html from src/ — commit it together with your src changes"
