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
  // data URIs (inlined build) pass through untouched; files resolve under
  // assets/ with a per-pageload cache-buster, so replacing a PNG on disk +
  // sync + plain refresh always shows the new art (no hard-refresh needed).
  const CB = '?cb=' + Date.now();
  const url = id => slots[id] ? (slots[id].startsWith('data:') ? slots[id] : 'assets/' + slots[id] + CB) : null;
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

/* ---- ui.* chrome slots, injected once as CSS so every element (including
   dynamically rendered ones) inherits them. 128×128 9-slice sources,
   border-image slice 42 (match-quest pattern). Missing slots = CSS chrome. */
(() => {
  const rules = [];
  const nine = (sel, slot, px) => {
    if (SKIN.has(slot)) rules.push(
      `${sel}{border:${px}px solid transparent;border-image:url(${SKIN.url(slot)}) 42 fill / ${px}px stretch;background:none;box-shadow:none;}`);
  };
  nine('button.primary', 'ui.button-primary', 12);
  nine('.hud, .fillmeter, .panel, .stats-body, .chip-info, .dev-drawer', 'ui.panel', 10);
  nine('.card', 'ui.overlay-card', 12);
  if (SKIN.has('ui.progressbar-track')) rules.push(
    `.bar{background:url(${SKIN.url('ui.progressbar-track')});background-size:100% 100%;border:none;}`);
  if (SKIN.has('ui.progressbar-fill')) rules.push(
    `.goalbar .fill{background:url(${SKIN.url('ui.progressbar-fill')});background-size:100% 100%;}`);
  if (rules.length) {
    const st = document.createElement('style');
    st.textContent = rules.join('\n');
    document.head.appendChild(st);
  }
})();
