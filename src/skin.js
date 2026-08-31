'use strict';
/* =========================================================================
   SKIN — asset-slot loader (ported from match-quest; see ASSET_MANIFEST.md).
   Maps slot ids → files via assets/skin.json. Any missing slot falls back to
   the built-in emoji/CSS rendering — the game must stay fully playable with
   zero art files present. Loaded synchronously BEFORE app.js so the UI can
   consult it on first render.

   Resolution order for colour-bearing art (SKIN.colored):
     bespoke per-colour file (`<kind>.<colourSlot>`) → tinted white-mask
     template (`<kind>`) → null (caller renders its emoji/CSS fallback).

   In the single-file playtest build (build.sh) skin.json is inlined as
   window.__SKIN_INLINE__ when present; art files are inlined as data URIs in
   the manifest itself at build time. Until that step exists, the gated build
   simply runs on fallbacks.
   ========================================================================= */
const SKIN = (() => {
  let slots = {};
  if (window.__SKIN_INLINE__) {
    slots = window.__SKIN_INLINE__.slots || {};
  } else {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'assets/skin.json?cb=' + Date.now(), false); // sync: tiny file, local server
      xhr.send(null);
      if (xhr.status === 200) slots = (JSON.parse(xhr.responseText).slots) || {};
    } catch (e) { console.warn('skin.json not loaded — emoji/CSS fallbacks active', e); }
  }
  // data URIs (inlined build) pass through untouched; files resolve under assets/
  const url = id => slots[id] ? (slots[id].startsWith('data:') ? slots[id] : 'assets/' + slots[id]) : null;
  // colour index ↔ manifest colour-slot names (bg0..bg5 in styles.css)
  const PIECE_SLOTS = ['red', 'yellow', 'green', 'blue', 'purple', 'orange'];
  return {
    has: id => !!slots[id],
    url,
    PIECE_SLOTS,
    // bespoke per-colour slot id, or null — e.g. colored('special.bomb', 0) → 'special.bomb.red'
    colored: (kind, colorIdx) => {
      const id = kind + '.' + PIECE_SLOTS[colorIdx];
      return slots[id] ? id : null;
    },
    count: Object.keys(slots).length,
  };
})();
window.SKIN = SKIN;
