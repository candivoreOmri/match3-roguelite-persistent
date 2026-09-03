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
  /* ---- tile styles: switchable piece-art sets (tester panel). A style is a
     folder holding <colour>.png (+ <colour>-boosted.png) for the six colours,
     listed in assets/tile-styles.json; 'default' = the pieces/ slots as
     mapped in skin.json. The gated build inlines every style's files under
     window.__SKIN_INLINE__.tileStyles[id][slot] as data URIs. ---- */
  const PIECE_SLOTS_ = ['red', 'yellow', 'green', 'blue', 'purple', 'orange'];
  const baseSlots = {};
  for (const c of PIECE_SLOTS_) { baseSlots['piece.' + c] = slots['piece.' + c]; baseSlots['piece.' + c + '.boosted'] = slots['piece.' + c + '.boosted']; }
  let tileStyles = [{ id: 'default', name: 'Default (pieces/)', dir: 'pieces' }];
  const inline = window.__SKIN_INLINE__ || null;
  if (inline && inline.tileStyleList) tileStyles = inline.tileStyleList;
  else if (!inline) {
    try {
      const xhr = new XMLHttpRequest(); xhr.open('GET', 'assets/tile-styles.json?cb=' + Date.now(), false); xhr.send(null);
      if (xhr.status === 200) tileStyles = JSON.parse(xhr.responseText).styles || tileStyles;
    } catch (e) { /* no styles file — default only */ }
  }
  let tileStyle = 'default';
  const applyTileStyle = id => {
    const st = tileStyles.find(t => t.id === id) || tileStyles[0];
    for (const c of PIECE_SLOTS_) {
      const a = 'piece.' + c, b = a + '.boosted';
      if (st.id === 'default') { slots[a] = baseSlots[a]; slots[b] = baseSlots[b]; continue; }
      if (inline && inline.tileStyles && inline.tileStyles[st.id]) { slots[a] = inline.tileStyles[st.id][a]; slots[b] = inline.tileStyles[st.id][b] || inline.tileStyles[st.id][a]; }
      else { slots[a] = st.dir + '/' + c + '.png'; slots[b] = st.dir + '/' + c + '-boosted.png'; }
    }
    tileStyle = st.id;
  };
  try { const saved = localStorage.getItem('rl_tile_style'); if (saved) applyTileStyle(saved); } catch (e) {}
  const api = {
    has: id => !!slots[id],
    url,
    PIECE_SLOTS,
    get tileStyles() { return tileStyles; },
    get tileStyle() { return tileStyle; },
    setTileStyle(id) { applyTileStyle(id); try { localStorage.setItem('rl_tile_style', id); } catch (e) {} },
    // bespoke per-colour slot id, or null — e.g. colored('special.bomb', 0) → 'special.bomb.red'
    colored: (kind, colorIdx) => {
      const id = kind + '.' + PIECE_SLOTS[colorIdx];
      return slots[id] ? id : null;
    },
    count: Object.keys(slots).length,
  };
  return api;
})();
window.SKIN = SKIN;

/* ---- ui.* chrome slots, injected once as CSS so every element (including
   dynamically rendered ones) inherits them. 128×128 9-slice sources,
   border-image slice 42 (match-quest pattern). Missing slots = CSS chrome. */
(() => {
  const rules = [];
  // slice 33% (not a pixel count) so 128px placeholders and 256px CD art both
  // keep their corners intact; `fill` paints the centre region
  const nine = (sel, slot, px) => {
    if (SKIN.has(slot)) rules.push(
      `${sel}{border:${px}px solid transparent;border-image:url(${SKIN.url(slot)}) 33% fill / ${px}px stretch;background:none !important;box-shadow:none;}`);
  };
  nine('button.primary', 'ui.button-primary', 14);
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
