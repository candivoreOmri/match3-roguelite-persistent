/* ============================================================================
   SHARED ENGINE — used by every roguelite variant (base, persistent, shop).
   Load order per variant: engine.js -> powerups.js -> the variant's app.js.
   The variant's app.js defines CONFIG (read at runtime only) and the UI, and
   may subclass or patch Game for its progression structure.
   Rules that must hold in every variant: seeded RNG for gameplay
   (Math.random for cosmetics only), group.active semantics, boardClears
   fire no match hooks, spawns never overwrite live specials.
   ========================================================================== */
'use strict';

const COLOR_NAMES = ['Red', 'Amber', 'Green', 'Blue', 'Purple', 'Orange'];
const SPECIAL_EMOJI = { bomb: '💣', arrow: '➡️', lightning: '⚡', dynamite: '🧨', cross: '✚' };
// Matryoshka decay chain: an exploding special leaves the next weaker one behind.
const MATRYOSHKA_NEXT = { lightning: 'bomb', cross: 'bomb', bomb: 'arrow', arrow: 'dynamite', dynamite: null };
const DIRS4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];

/* ----------------------------- Seeded RNG -------------------------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const K = (r, c) => r + ',' + c;

/* --------------------------- Play telemetry ------------------------------
   Every finished level is logged to localStorage so difficulty can be tuned
   from real play. Scripted/bot runs carry fast:true and are excluded from
   the human summaries. Access via RL.telemetry or the 📊 panel on the menu. */
const TELEMETRY_KEY = 'rl_telemetry_v1';
const TELEMETRY_MAX_RECORDS = 500;
function telemetryAll() {
  try { return JSON.parse(localStorage.getItem(TELEMETRY_KEY)) || []; } catch (e) { return []; }
}
function telemetrySave(rec) {
  try {
    const all = telemetryAll();
    all.push(rec);
    while (all.length > TELEMETRY_MAX_RECORDS) all.shift();
    localStorage.setItem(TELEMETRY_KEY, JSON.stringify(all));
  } catch (e) { /* storage unavailable — prototype keeps playing */ }
  if (!rec.fast) telemetrySend(rec); // bot/test runs stay local-only
}
function telemetryClear() {
  try { localStorage.removeItem(TELEMETRY_KEY); } catch (e) {}
}
// Anonymous per-browser id so remote records group by tester without any PII.
function telemetryClientId() {
  try {
    let id = localStorage.getItem('rl_client_id');
    if (!id) {
      id = 'c' + Math.random().toString(36).slice(2, 10); // cosmetic randomness — not the game RNG
      localStorage.setItem('rl_client_id', id);
    }
    return id;
  } catch (e) { return 'c-unknown'; }
}
// Fire-and-forget remote send; disabled while CONFIG endpoints are empty.
// Never throws, never blocks gameplay, never replaces the localStorage copy.
function telemetrySend(rec) {
  if (!CONFIG.TELEMETRY_ENDPOINT || !CONFIG.TELEMETRY_KEY) return;
  try {
    fetch(CONFIG.TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.TELEMETRY_KEY,
        Authorization: 'Bearer ' + CONFIG.TELEMETRY_KEY,
      },
      body: JSON.stringify({ client: telemetryClientId(), payload: rec }),
    }).catch(() => {});
  } catch (e) { /* blocked environment (e.g. artifact CSP) — local copy remains */ }
}
function telemetrySummary(includeBot = false, version = null) {
  const recs = telemetryAll().filter(r => (includeBot || !r.fast) && (version === null || r.v === version));
  const byLevel = {};
  for (const r of recs) {
    const b = byLevel[r.level] || (byLevel[r.level] = { level: r.level, plays: 0, clears: 0, ppm: 0, score: 0 });
    b.plays++; if (r.result === 'clear') b.clears++;
    b.ppm += r.ppm; b.score += r.score;
  }
  return Object.values(byLevel).sort((a, b) => a.level - b.level).map(b => ({
    level: b.level, plays: b.plays,
    clearRate: +(b.clears / b.plays).toFixed(2),
    avgPtsPerMove: +(b.ppm / b.plays).toFixed(1),
    avgScore: Math.round(b.score / b.plays),
    target: CONFIG.SCORE_TARGETS[Math.min(b.level - 1, CONFIG.SCORE_TARGETS.length - 1)],
  }));
}


/* ================================ ENGINE ================================== */
class Game {
  constructor(onRender) {
    this.onRender = onRender;
    this.phase = 'menu';          // menu | draft | level | clear | win | loss
    this.opts = { draftOptions: CONFIG.DRAFT_OPTIONS, colours: CONFIG.COLOURS };
    this.fx = []; this.callouts = []; this.fxId = 1; this.tileId = 1;
    this.busy = false; this.shake = false;
    this.pinatas = new Map(); this.triples = new Set(); this.tripleArmed = false;
    this.fast = false; // debug: skip animation delays (scripted tests set this)
    this.run = null; this.board = null;
    this.mods = this.emptyMods();
  }

  render() { this.onRender(); }
  // fast=true skips animation delays (scripted testing; hidden tabs throttle timers)
  sleep(ms) { return this.fast ? Promise.resolve() : new Promise(res => setTimeout(res, ms)); }
  // Seam for variants: tiles that nothing on the board may clear, recolour,
  // or transform (board effects, explosions, floods/converter, reshuffles).
  // Base behaviour: chests and chompers. Chomper's own eating is exempt —
  // his prey rules live in chomperMove.
  protectedTile(t) { return !!(t && (t.chest || t.chomper)); }

  // Seam for variants: tiles the player can never swap. Base: chomper only.
  immovableTile(t) { return !!(t && t.chomper); }

  // Seam for variants: a clear attempt (match extras, line clears, sweeps,
  // explosions) landed on a protected tile. opts carries kind/src/depth.
  // Base: nothing happens — protected tiles just don't clear.
  onTileProtected(r, c, t, opts) {}

  // Seam for variants: called when a protected tile stops Chomper's step
  // (the blocker's cell + tile). Base: nothing happens — he just stays put.
  onChomperBlocked(r, c, t) {}

  // Seam for variants: tiles gravity never moves — they hang in place, tiles
  // above them stack on top, and slots beneath them stay EMPTY (refills only
  // enter a column from the top). Base: none.
  gravityFixed(t) { return false; }

  emptyMods() {
    return { boosts: {}, bombChance: 0, autoExplode: false, countdown: false,
             blastBonus: 0, specialScore: 0, expandRows: 0, expandCols: 0,
             marks: 0, square: false, lifesaver: false, fillup: false,
             spawnWeight: 0, matryoshka: false, aftershock: false, tempo: false, diagSwap: false,
             conveyor: false, lava: false, chomper: false, squareBomb: false,
             doubleBite: 0, gourmet: false, spicyTrail: false, chomperBomb: false };
  }

  /* ------------------------------ Run flow ------------------------------ */
  newRun(seed) {
    this.seed = (seed >>> 0) || 1;
    this.rng = mulberry32(this.seed);
    this.run = { level: 0, picks: [], draftHistory: [], totalScore: 0, snowball: 0, momentum: 0,
                 fillCount: 0, fillTriggers: 0, multiplier: 1, lifesaverUsed: false };
    this.busy = false;
    this.computeMods();
    this.startDraft();
  }

  computeMods() {
    const m = this.emptyMods();
    for (const p of this.run.picks) {
      const def = POWERUPS[p.id];
      if (def.mods) def.mods(m, p, this);
    }
    this.mods = m;
  }

  emit(hook, ...args) {
    for (const p of this.run.picks) {
      const def = POWERUPS[p.id];
      if (def[hook]) def[hook](this, p, ...args);
    }
  }

  startDraft() {
    this.run.level++;
    this.offers = this.makeOffers();
    this.phase = 'draft';
    this.render();
  }

  makeOffers() {
    const n = Math.max(2, Math.min(3, this.opts.draftOptions | 0));
    const hasBoost = Object.keys(this.mods.boosts).length > 0;
    const gateOk = d =>
      (!d.requiresBoost || hasBoost) &&
      (!d.requiresSquare || this.mods.square) &&
      (!d.requiresChomper || this.mods.chomper);
    const available = d =>
      !d.disabled && gateOk(d) &&
      (d.stackable || !this.run.picks.some(p => p.id === d.id));
    // legendaries live outside the normal pool (see legendary slot below)
    const pool = POWERUP_LIST.filter(d =>
      available(d) && d.tier !== 3 &&
      (d.tier === 1 || this.run.level >= CONFIG.STRONG_POWERUPS_FROM_LEVEL));

    // cluster-normalized rarity: weight = MASS / (available cluster members),
    // so drafts show cluster variety instead of mirroring cluster headcounts
    const clusterN = {};
    pool.forEach(d => { clusterN[d.cluster] = (clusterN[d.cluster] || 0) + 1; });
    const weightOf = d => {
      let w = Math.min(CONFIG.WEIGHT_MAX, Math.max(CONFIG.WEIGHT_MIN, CONFIG.CLUSTER_WEIGHT_MASS / clusterN[d.cluster]));
      const inCluster = this.run.picks.filter(p => POWERUPS[p.id].cluster === d.cluster).length;
      w *= 1 + CONFIG.SYNERGY_CLUSTER_WEIGHT * inCluster;
      if (d.requiresBoost || d.requiresSquare || d.requiresChomper) w *= CONFIG.UPGRADE_WEIGHT;
      return w;
    };

    const offers = [];
    while (offers.length < n && pool.length) {
      const weights = pool.map(weightOf);
      const total = weights.reduce((a, b) => a + b, 0);
      let x = this.rng() * total, idx = 0;
      while (idx < pool.length - 1 && x > weights[idx]) { x -= weights[idx]; idx++; }
      const def = pool.splice(idx, 1)[0];
      offers.push({ id: def.id, ...(def.roll ? def.roll(this) : {}) });
    }

    // legendary slot: from L5, a chance that the last offer is a legendary
    if (this.run.level >= CONFIG.LEGENDARY_FROM_LEVEL && this.rng() < CONFIG.LEGENDARY_SLOT_CHANCE) {
      const legs = POWERUP_LIST.filter(d => d.tier === 3 && available(d));
      if (legs.length && offers.length) {
        const def = legs[Math.floor(this.rng() * legs.length)];
        offers[offers.length - 1] = { id: def.id, ...(def.roll ? def.roll(this) : {}) };
      }
    }
    return offers;
  }

  pickOffer(i) {
    if (this.phase !== 'draft' || !this.offers[i]) return;
    // Log the whole offer set so telemetry can compute pick-rate-when-offered,
    // not just share-of-drafts.
    const key = o => o.id + (o.color !== undefined ? ':' + o.color : '');
    this.run.draftHistory.push({ offered: this.offers.map(key), picked: key(this.offers[i]) });
    this.run.picks.push(this.offers[i]);
    this.computeMods();
    this.startLevel();
  }

  startLevel() {
    const idx = Math.min(this.run.level - 1, CONFIG.MOVES_PER_LEVEL.length - 1);
    const tIdx = Math.min(this.run.level - 1, CONFIG.SCORE_TARGETS.length - 1);
    this.rows = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_ROWS + this.mods.expandRows);
    this.cols = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_COLS + this.mods.expandCols);
    this.movesLeft = CONFIG.MOVES_PER_LEVEL[idx];
    this.lastWarnedMoves = null;
    this.target = Math.round(CONFIG.SCORE_TARGETS[tIdx] * (CONFIG.COLOUR_TARGET_SCALE[this.opts.colours] || 1));
    this.score = 0;
    this.movesUsed = 0; this.moveScores = [];
    this.moveNum = 0;        // 1-based during a move; drives Snowball and Aftershock expiry
    this.tempoUsed = false;  // Tempo's ×3 is armed until the level's first match
    this.genBoard();
    this.genMarks();
    this.pinatas = new Map(); this.triples = new Set(); this.tripleArmed = false;
    this.lastSwapDir = null;
    this.emit('onLevelStart');
    if (!this.findAnyMove()) this.reshuffleBoard(); // placed pieces can rarely kill the only move
    this.phase = 'level';
    this.busy = false;
    this.render();
  }

  continueRun() {
    if (this.phase !== 'clear') return;
    this.startDraft();
  }

  checkLevelEnd() {
    if (this.phase !== 'level') return;
    if (this.score >= this.target) {
      this.run.totalScore += this.score;
      this.logLevel('clear');
      this.phase = this.run.level >= CONFIG.LEVELS_PER_RUN ? 'win' : 'clear';
    } else if (this.movesLeft <= 0) {
      if (this.mods.lifesaver && !this.run.lifesaverUsed) {
        this.run.lifesaverUsed = true;
        this.movesLeft += CONFIG.LIFESAVER_BONUS_MOVES;
        this.callout(`🛟 Lifesaver! +${CONFIG.LIFESAVER_BONUS_MOVES} moves`);
      } else {
        this.run.totalScore += this.score;
        this.logLevel('loss');
        this.phase = 'loss';
      }
    }
  }

  logLevel(result) {
    const idx = Math.min(this.run.level - 1, CONFIG.MOVES_PER_LEVEL.length - 1);
    telemetrySave({
      t: Date.now(), seed: this.seed, level: this.run.level, result,
      target: this.target, score: this.score,
      movesAllowed: CONFIG.MOVES_PER_LEVEL[idx], movesUsed: this.movesUsed,
      ppm: +(this.score / Math.max(1, this.movesUsed)).toFixed(1),
      moveScores: this.moveScores.slice(),
      picks: this.run.picks.map(p => p.id + (p.color !== undefined ? ':' + p.color : '')),
      draft: this.run.draftHistory[this.run.level - 1] || null, // {offered, picked} for this level
      rows: this.rows, cols: this.cols, draftOptions: this.opts.draftOptions,
      colours: this.opts.colours, v: CONFIG.BALANCE_VERSION,
      fast: !!this.fast, // bot/test runs — excluded from human summaries
    });
  }

  /* ---------------------------- Board setup ----------------------------- */
  // initial=true for the level's starting fill — Bomb chance only applies to
  // tiles spawned by refills after the player has made a move.
  makeTile(color, initial = false) {
    const t = { id: this.tileId++, color, special: null, dir: null, countdown: null };
    if (!initial && this.mods.bombChance > 0 && this.rng() < this.mods.bombChance) {
      t.special = 'bomb';
      if (this.mods.countdown) t.countdown = CONFIG.COUNTDOWN_TIMER_START;
    }
    return t;
  }

  rollColorAvoidingMatches(r, c) {
    const b = this.board, bad = new Set();
    if (c >= 2 && b[r][c - 1] && b[r][c - 2] && b[r][c - 1].color === b[r][c - 2].color) bad.add(b[r][c - 1].color);
    if (r >= 2 && b[r - 1][c] && b[r - 2][c] && b[r - 1][c].color === b[r - 2][c].color) bad.add(b[r - 1][c].color);
    if (this.mods.square && r >= 1 && c >= 1 &&
        b[r - 1][c] && b[r - 1][c - 1] && b[r][c - 1] &&
        b[r - 1][c].color === b[r - 1][c - 1].color && b[r][c - 1].color === b[r - 1][c].color)
      bad.add(b[r - 1][c].color);
    let color;
    do { color = Math.floor(this.rng() * this.opts.colours); } while (bad.has(color) && bad.size < this.opts.colours);
    return color;
  }

  genBoard() {
    for (let tries = 0; tries < 60; tries++) {
      this.board = Array.from({ length: this.rows }, () => Array(this.cols).fill(null));
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++)
          this.board[r][c] = this.makeTile(this.rollColorAvoidingMatches(r, c), true);
      if (this.findAnyMove()) return;
    }
  }

  genMarks() {
    this.marks = new Set();
    const want = Math.min(this.mods.marks, this.rows * this.cols - 1);
    let guard = 0;
    while (this.marks.size < want && guard++ < 500) {
      const r = Math.floor(this.rng() * this.rows), c = Math.floor(this.rng() * this.cols);
      // edges are fine for xtra-move marks, corners are not (too few matches reach them)
      if ((r === 0 || r === this.rows - 1) && (c === 0 || c === this.cols - 1)) continue;
      this.marks.add(K(r, c));
    }
  }

  // interior cell roll for marks that need match coverage from all sides
  rollInteriorCell() {
    return K(1 + Math.floor(this.rng() * (this.rows - 2)), 1 + Math.floor(this.rng() * (this.cols - 2)));
  }

  // Refill colour roll — Spawn weight tilts the distribution toward boosted colours.
  rollRefillColor() {
    if (!this.mods.spawnWeight) return Math.floor(this.rng() * this.opts.colours);
    const weights = [];
    let total = 0;
    for (let c = 0; c < this.opts.colours; c++) {
      const w = 1 + (this.mods.boosts[c] ? this.mods.spawnWeight : 0);
      weights.push(w); total += w;
    }
    let x = this.rng() * total;
    for (let c = 0; c < weights.length; c++) { if (x < weights[c]) return c; x -= weights[c]; }
    return weights.length - 1;
  }

  reshuffleBoard() {
    for (let tries = 0; tries < 40; tries++) {
      for (let r = 0; r < this.rows; r++)
        for (let c = 0; c < this.cols; c++)
          if (this.board[r][c] && !this.protectedTile(this.board[r][c])) this.board[r][c].color = this.rollColorAvoidingMatches(r, c);
      if (this.findAnyMove() && !this.findGroups().length) return;
    }
  }

  /* --------------------------- Match detection -------------------------- */
  findRuns() {
    const runs = [], b = this.board;
    for (let r = 0; r < this.rows; r++) {
      let c = 0;
      while (c < this.cols) {
        const t = b[r][c];
        if (!t || t.color < 0) { c++; continue; } // neutral pieces (chest/chomper) never start runs
        let len = 1;
        while (c + len < this.cols && b[r][c + len] && b[r][c + len].color === t.color) len++;
        if (len >= 3) runs.push({ dir: 'h', color: t.color, cells: Array.from({ length: len }, (_, i) => ({ r, c: c + i })) });
        c += len;
      }
    }
    for (let c = 0; c < this.cols; c++) {
      let r = 0;
      while (r < this.rows) {
        const t = b[r][c];
        if (!t || t.color < 0) { r++; continue; } // neutral pieces never start runs
        let len = 1;
        while (r + len < this.rows && b[r + len][c] && b[r + len][c].color === t.color) len++;
        if (len >= 3) runs.push({ dir: 'v', color: t.color, cells: Array.from({ length: len }, (_, i) => ({ r: r + i, c })) });
        r += len;
      }
    }
    return runs;
  }

  findGroups() {
    const runs = this.findRuns();
    const parent = runs.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const cellRun = new Map();
    runs.forEach((run, i) => {
      for (const cl of run.cells) {
        const k = K(cl.r, cl.c);
        if (cellRun.has(k)) union(cellRun.get(k), i); else cellRun.set(k, i);
      }
    });
    const byRoot = new Map();
    runs.forEach((run, i) => {
      const root = find(i);
      if (!byRoot.has(root)) byRoot.set(root, { color: run.color, cells: [], cellSet: new Set(), runs: [], square: false });
      const g = byRoot.get(root);
      g.runs.push(run);
      for (const cl of run.cells) {
        const k = K(cl.r, cl.c);
        if (!g.cellSet.has(k)) { g.cellSet.add(k); g.cells.push(cl); }
      }
    });
    const groups = [...byRoot.values()];
    if (this.mods.square) {
      for (let r = 0; r < this.rows - 1; r++) for (let c = 0; c < this.cols - 1; c++) {
        const t = this.board[r][c];
        if (!t || t.color < 0) continue;
        const cells = [{ r, c }, { r, c: c + 1 }, { r: r + 1, c }, { r: r + 1, c: c + 1 }];
        if (!cells.every(cl => this.board[cl.r][cl.c] && this.board[cl.r][cl.c].color === t.color)) continue;
        // A square counts even when its cells are also part of a straight run
        // (e.g. a 2x2 with a 3rd piece on top): merge it into the overlapping
        // group so everything clears together and square behaviour applies.
        const overlapping = groups.filter(g => cells.some(cl => g.cellSet.has(K(cl.r, cl.c))));
        if (overlapping.length) {
          const g = overlapping[0];
          for (const other of overlapping.slice(1)) {
            for (const cl of other.cells) if (!g.cellSet.has(K(cl.r, cl.c))) { g.cellSet.add(K(cl.r, cl.c)); g.cells.push(cl); }
            g.runs.push(...other.runs);
            groups.splice(groups.indexOf(other), 1);
          }
          for (const cl of cells) if (!g.cellSet.has(K(cl.r, cl.c))) { g.cellSet.add(K(cl.r, cl.c)); g.cells.push(cl); }
          g.square = true;
        } else {
          groups.push({ color: t.color, cells, cellSet: new Set(cells.map(cl => K(cl.r, cl.c))), runs: [], square: true });
        }
      }
    }
    return groups;
  }

  findAnyMove() {
    const b = this.board;
    const offsets = this.mods.diagSwap ? [[0, 1], [1, 0], [1, 1], [1, -1]] : [[0, 1], [1, 0]];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      for (const [dr, dc] of offsets) {
        const r2 = r + dr, c2 = c + dc;
        if (r2 >= this.rows || c2 < 0 || c2 >= this.cols || !b[r][c] || !b[r2][c2]) continue;
        if (this.immovableTile(b[r][c]) || this.immovableTile(b[r2][c2])) continue; // immovable pieces can't be swapped
        // adjacent specials can always merge
        if (b[r][c].special && b[r2][c2].special) return { a: { r, c }, b: { r: r2, c: c2 } };
        [b[r][c], b[r2][c2]] = [b[r2][c2], b[r][c]];
        const ok = this.findRuns().length > 0;
        [b[r][c], b[r2][c2]] = [b[r2][c2], b[r][c]];
        if (ok) return { a: { r, c }, b: { r: r2, c: c2 } };
      }
    }
    return null;
  }

  /* ------------------------- Specials & explosions ---------------------- */
  groupSpawnType(g) {
    if (g.square) return this.mods.squareBomb ? 'bomb' : 'dynamite';
    const hasH = g.runs.some(x => x.dir === 'h'), hasV = g.runs.some(x => x.dir === 'v');
    if (hasH && hasV) return CONFIG.MATCH_SHAPE_SPAWNS;
    const maxLen = Math.max(...g.runs.map(x => x.cells.length));
    if (maxLen >= 5) return CONFIG.MATCH_5_SPAWNS;
    if (maxLen === 4) return CONFIG.MATCH_4_SPAWNS;
    return null;
  }

  makeSpecial(type, group, dirOverride) {
    const t = { id: this.tileId++, color: group.color, special: type, dir: null,
                countdown: this.mods.countdown ? CONFIG.COUNTDOWN_TIMER_START : null, fresh: true };
    if (type === 'arrow') {
      if (dirOverride) t.dir = dirOverride;
      else {
        const run = group.runs.find(x => x.cells.length >= 4) || group.runs[0];
        t.dir = run && run.dir === 'h' ? 'v' : 'h'; // horizontal match → column-clearing arrow
      }
    }
    return t;
  }

  explosionCells(r, c, t) {
    const cells = [];
    const push = (rr, cc) => { if (rr >= 0 && rr < this.rows && cc >= 0 && cc < this.cols) cells.push({ r: rr, c: cc }); };
    if (t.special === 'bomb') {
      const rad = Math.min(CONFIG.MAX_BOMB_RADIUS, 1 + this.mods.blastBonus);
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) push(r + dr, c + dc);
    } else if (t.special === 'arrow') {
      if (t.dir === 'h') for (let cc = 0; cc < this.cols; cc++) push(r, cc);
      else for (let rr = 0; rr < this.rows; rr++) push(rr, c);
    } else if (t.special === 'lightning') {
      for (let rr = 0; rr < this.rows; rr++) for (let cc = 0; cc < this.cols; cc++) {
        const o = this.board[rr][cc];
        if (o && o.color === t.color) push(rr, cc);
      }
    } else if (t.special === 'dynamite') {
      push(r, c); push(r - 1, c); push(r + 1, c); push(r, c - 1); push(r, c + 1);
    } else if (t.special === 'cross') {
      // transient piece made by merging two arrows: full row + full column
      for (let cc = 0; cc < this.cols; cc++) push(r, cc);
      for (let rr = 0; rr < this.rows; rr++) push(rr, c);
    }
    return cells;
  }

  /* --------------------------- Step resolution --------------------------
     One "step" = clear matched groups (+ power-up extras), chain special
     explosions, spawn new specials, score everything, flag tiles to pop.  */
  // boardClears: cells removed as a pure board effect (e.g. Floor is lava) —
  // they score and detonate specials, but fire no match hooks and never touch
  // xtra-move marks.
  processStep(groups, swapCells, seeds, boardClears = []) {
    const cleared = new Map();     // key -> {r,c,explosion,delay,kind,src}
    const spawns = new Map();      // key -> new special tile
    const floods = [];             // {cells|null, color} pending conversions (null = board-wide)
    const queue = [];              // explosion chain: {r,c,depth}
    let bonusPts = 0;              // flat bonus points added by hooks (e.g. Snowball)
    let maxDelay = 0;              // longest pop stagger this step (engine waits it out)

    // kind drives the pop animation: match | boom | zap | line | sweep
    // delay staggers pops so blasts ripple outward and lines wipe along
    // src buckets the score popups per cause
    const addClear = (r, c, explosion, opts = {}) => {
      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
      const t = this.board[r][c];
      if (!t) return false;
      if (this.protectedTile(t)) { this.onTileProtected(r, c, t, opts); return false; } // indestructible — but the hit is reported
      const k = K(r, c);
      if (cleared.has(k)) return false;
      const delay = Math.min(500, opts.delay || 0);
      maxDelay = Math.max(maxDelay, delay);
      cleared.set(k, { r, c, explosion, delay, kind: opts.kind || (explosion ? 'boom' : 'match'), src: opts.src || 'misc' });
      if (t.special) queue.push({ r, c, depth: (opts.depth || 0) + 1 });
      return true;
    };

    const pickSpawnCell = g => {
      // never spawn onto an existing special — that used to swallow its
      // explosion (a bomb swapped into a 4-match just became an arrow)
      const free = g.cells.filter(cl => {
        const t = this.board[cl.r][cl.c];
        return !spawns.has(K(cl.r, cl.c)) && t && !t.special;
      });
      if (!free.length) return null;
      if (swapCells) {
        const hit = free.find(cl => swapCells.some(s => s.r === cl.r && s.c === cl.c));
        if (hit) return hit;
      }
      return free[Math.floor(free.length / 2)];
    };

    groups.forEach((g, gi) => { g.src = 'g' + gi; });
    for (const g of groups) {
      // active = made directly by the player's swap (not a cascade match)
      g.active = !!(swapCells && g.cells.some(cl => swapCells.some(s => s.r === cl.r && s.c === cl.c)));
      for (const cl of g.cells) addClear(cl.r, cl.c, false, { kind: 'match', src: g.src });
      // particle burst from the matched group's centre, in its colour
      const cr = g.cells.reduce((s, cl) => s + cl.r, 0) / g.cells.length;
      const cc = g.cells.reduce((s, cl) => s + cl.c, 0) / g.cells.length;
      this.addParticles(cr, cc, g.color);
      const type = this.groupSpawnType(g);
      if (type) {
        const cell = pickSpawnCell(g);
        if (cell) spawns.set(K(cell.r, cell.c), this.makeSpecial(type, g));
      }
    }

    // Power-up hooks may extend the cleared set / add spawns / queue floods.
    const api = {
      clearColor: (color, g) => {
        // sweep ripples outward from the match that triggered it
        const anchor = g && g.cells.length ? g.cells[0] : { r: 0, c: 0 };
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          const t = this.board[r][c];
          if (t && t.color === color) {
            const d = (Math.abs(r - anchor.r) + Math.abs(c - anchor.c)) * CONFIG.LINE_STAGGER_MS;
            addClear(r, c, false, { kind: 'sweep', delay: d, src: g ? g.src : 'misc' });
          }
        }
        if (g && g.cells.length) this.addFx(g.cells[0].r, g.cells[0].c, '🧹', 'emoji');
      },
      clearLines: (g, dir) => {
        // line clears wipe outward from the matched run
        for (const run of g.runs) {
          if (dir && run.dir !== dir) continue;
          if (run.dir === 'h') {
            const r = run.cells[0].r, from = run.cells[Math.floor(run.cells.length / 2)].c;
            for (let c = 0; c < this.cols; c++) addClear(r, c, false, { kind: 'line', delay: Math.abs(c - from) * CONFIG.LINE_STAGGER_MS, src: g.src });
          } else {
            const c = run.cells[0].c, from = run.cells[Math.floor(run.cells.length / 2)].r;
            for (let r = 0; r < this.rows; r++) addClear(r, c, false, { kind: 'line', delay: Math.abs(r - from) * CONFIG.LINE_STAGGER_MS, src: g.src });
          }
        }
      },
      flood: (g, color) => floods.push({ cells: g.cells, color }),
      convertRandom: color => floods.push({ cells: null, color }), // any surviving tile, board-wide
      addBonus: n => { bonusPts += n; },
      spawnRandomSpecial: g => {
        const free = g.cells.filter(cl => {
          const t = this.board[cl.r][cl.c];
          return !spawns.has(K(cl.r, cl.c)) && t && !t.special; // don't overwrite live specials
        });
        if (!free.length) return;
        const cell = free[Math.floor(this.rng() * free.length)];
        const type = ['bomb', 'arrow', 'lightning'][Math.floor(this.rng() * 3)];
        const dir = this.rng() < 0.5 ? 'h' : 'v';
        spawns.set(K(cell.r, cell.c), this.makeSpecial(type, g, dir));
        this.addFx(cell.r, cell.c, '✨', 'emoji');
      },
    };
    for (const g of groups) this.emit('onMatch', g, api);

    // Matching a scorched (volatile) tile sets off a small + blast there.
    // Volatile tiles come from Aftershock (explosion edges) or Spicy Trail
    // (chomper's wake) — the trigger works for whichever is owned.
    if (this.mods.aftershock || this.mods.spicyTrail) {
      for (const g of groups) for (const cl of g.cells) {
        const t = this.board[cl.r][cl.c];
        if (t && t.volatile && t.volatile >= this.moveNum) {
          t.volatile = 0;
          this.addFx(cl.r, cl.c, '💢', 'emoji');
          this.addWave(cl.r, cl.c, 3, 0);
          for (const cell of this.explosionCells(cl.r, cl.c, { special: 'dynamite' }))
            addClear(cell.r, cell.c, true, { delay: (Math.abs(cell.r - cl.r) + Math.abs(cell.c - cl.c)) * CONFIG.BOOM_STAGGER_MS, src: 'a' + K(cl.r, cl.c) });
        }
      }
    }

    // Board-effect clears (no group, no hooks — just removal + special chains).
    for (const cl of boardClears) addClear(cl.r, cl.c, false, { kind: 'lava', src: 'lava' });

    // Countdown / auto-explode seeds explode even without a match.
    for (const s of seeds || []) {
      const t = this.board[s.r][s.c];
      if (!t || !t.special) continue;
      const k = K(s.r, s.c);
      if (!cleared.has(k)) {
        cleared.set(k, { r: s.r, c: s.c, explosion: true, delay: 0, kind: t.special === 'lightning' ? 'zap' : 'boom', src: 'e' + k });
        queue.push({ r: s.r, c: s.c, depth: 0 });
      }
    }

    // Chain explosions.
    const exploded = new Set();
    const WAVE_SIZE = { bomb: () => 2 * Math.min(CONFIG.MAX_BOMB_RADIUS, 1 + this.mods.blastBonus) + 1, dynamite: () => 3, lightning: () => 5, cross: () => 0, arrow: () => 0 };
    while (queue.length) {
      const { r, c, depth = 0 } = queue.shift();
      const k = K(r, c);
      if (exploded.has(k) || spawns.has(k)) continue;
      exploded.add(k);
      const t = this.board[r][c];
      if (!t || !t.special) continue;
      const baseDelay = depth * CONFIG.CHAIN_STAGGER_MS;
      const kind = t.special === 'lightning' ? 'zap' : 'boom';
      this.addFx(r, c, t.special === 'lightning' ? '⚡' : '💥', 'emoji');
      const waveSize = (WAVE_SIZE[t.special] || (() => 0))();
      if (waveSize) this.addWave(r, c, waveSize, baseDelay);
      for (const cl of this.explosionCells(r, c, t)) {
        const dist = Math.max(Math.abs(cl.r - r), Math.abs(cl.c - c));
        addClear(cl.r, cl.c, true, { kind, delay: baseDelay + dist * CONFIG.BOOM_STAGGER_MS, src: 'e' + k, depth });
      }
      // Matryoshka: the exploding special leaves the next weaker one at its cell.
      if (this.mods.matryoshka) {
        const next = MATRYOSHKA_NEXT[t.special];
        if (next && !spawns.has(k)) {
          spawns.set(k, { id: this.tileId++, color: t.color, special: next,
            dir: next === 'arrow' ? (this.rng() < 0.5 ? 'h' : 'v') : null,
            countdown: this.mods.countdown ? CONFIG.COUNTDOWN_TIMER_START : null, fresh: true });
        }
      }
    }

    // Aftershock: surviving tiles on the edge of a SPECIAL-PIECE explosion
    // (src 'e...') turn volatile through the next move. Secondary volatile
    // blasts (src 'a...') never scorch — aftershock must not chain itself.
    if (this.mods.aftershock) {
      for (const { r, c, explosion, src } of cleared.values()) {
        if (!explosion || !src || src[0] !== 'e') continue;
        for (const [dr, dc] of DIRS4) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;
          const t = this.board[rr][cc];
          if (t && !this.protectedTile(t) && !cleared.has(K(rr, cc))) t.volatile = this.moveNum + 1;
        }
      }
    }

    // Xtra-move marks: only a DELIBERATE match (the player's swapped group)
    // over a marked cell refunds the move — cascades, explosions, sweeps, and
    // board effects all leave marks untouched. One mark consumed per move.
    if (!this.refund) {
      const activeSrcs = new Set(groups.filter(g => g.active).map(g => g.src));
      for (const { r, c, kind, src } of cleared.values()) {
        if (kind !== 'match' || !activeSrcs.has(src)) continue;
        const k = K(r, c);
        if (this.marks.has(k)) { this.marks.delete(k); this.refund = true; break; }
      }
    }

    // Piñata cells: every clear over one (match, cascade, or explosion) is a hit.
    if (this.pinatas.size) {
      for (const k of cleared.keys()) {
        if (!this.pinatas.has(k)) continue;
        const left = this.pinatas.get(k) - 1;
        const [pr, pc] = k.split(',').map(Number);
        if (left <= 0) {
          this.pinatas.delete(k);
          this.score += CONFIG.PINATA_POINTS;
          this.addFx(pr, pc, `🪅 +${CONFIG.PINATA_POINTS}`, 'big');
        } else {
          this.pinatas.set(k, left);
          this.addFx(pr, pc, '🪅', 'emoji');
        }
      }
    }

    // Triple tile: a match the player makes over it arms a whole-move ×N,
    // paid out in trySwap once the move fully resolves. One use.
    if (this.triples.size) {
      for (const g of groups) {
        if (!g.active) continue;
        for (const cl of g.cells) {
          const k = K(cl.r, cl.c);
          if (this.triples.has(k)) {
            this.triples.delete(k);
            this.tripleArmed = true;
            this.addFx(cl.r, cl.c, `✖${CONFIG.TRIPLE_TILE_MULT}!`, 'big');
          }
        }
      }
    }

    // Score: 1/tile + colour boost, × multiplier. Special-score pays its bonus
    // on the exploding special piece itself, not on the tiles it clears.
    let pts = 0, cnt = 0;
    const buckets = new Map(); // src -> {pts, n, sumR, sumC, bonus} for per-cause score popups
    for (const { r, c, delay, kind, src } of cleared.values()) {
      const t = this.board[r][c];
      const boost = this.mods.boosts[t.color] || 0;
      const spBonus = exploded.has(K(r, c)) ? this.mods.specialScore : 0;
      const p = (1 + boost + spBonus) * this.run.multiplier;
      pts += p; cnt++;
      t.pop = true; t.popDelay = delay; t.popKind = kind;
      const b = buckets.get(src) || { pts: 0, n: 0, sumR: 0, sumC: 0, bonus: false };
      b.pts += p; b.n++; b.sumR += r; b.sumC += c;
      b.bonus = b.bonus || boost > 0 || spBonus > 0;
      buckets.set(src, b);
    }
    pts += bonusPts * this.run.multiplier; // flat hook bonuses (Snowball)
    // Tempo: the level's first match step scores ×N.
    let tempoMult = 1;
    if (this.mods.tempo && !this.tempoUsed && groups.length && cnt) {
      this.tempoUsed = true;
      tempoMult = CONFIG.TEMPO_MULT;
      pts *= tempoMult;
      this.callout(`🎺 Tempo ×${CONFIG.TEMPO_MULT}!`);
    }
    this.score += pts;
    // gold popup = the number includes some bonus (boost / special score /
    // multiplier / tempo); plain clears stay white
    const goldAll = this.run.multiplier > 1 || tempoMult > 1;
    for (const b of buckets.values()) {
      const shown = b.pts * tempoMult;
      this.addFx(b.sumR / b.n, b.sumC / b.n, `+${shown}`, ((b.bonus || goldAll) ? 'gold' : '') + (shown >= 40 ? ' big' : ''));
    }
    if (bonusPts) this.addFx(0.2, this.cols / 2 - 0.5, `❄️ +${bonusPts * this.run.multiplier * tempoMult}`, 'gold big');
    // shake from 8 cleared, intensity scales with count (board-only, CSS transform)
    if (cnt >= 8) this.doShake(Math.min(12, Math.round(cnt * 0.5)));

    return { cleared, spawns, floods, cnt, pts, maxDelay };
  }

  applyStep(res) {
    for (const { r, c } of res.cleared.values()) {
      if (!res.spawns.has(K(r, c))) this.board[r][c] = null;
    }
    for (const [k, tile] of res.spawns) {
      const [r, c] = k.split(',').map(Number);
      this.board[r][c] = tile;
      setTimeout(() => { delete tile.fresh; }, 400);
    }
  }

  // Flood / Converter conversions — applied AFTER gravity settles (they used
  // to run pre-gravity inside applyStep, which let a conversion recolour a
  // tile that was about to complete a cascade, silently denying it, and made
  // the avoid-cascade preference judge a board that no longer existed).
  // Tiles that are part of a SETTLED match are never conversion targets.
  applyFloods(floods) {
    if (!floods || !floods.length) return;
    const matched = new Set();
    for (const g of this.findGroups()) for (const cl of g.cells) matched.add(K(cl.r, cl.c));
    for (const f of floods) {
      const cands = [], seen = new Set();
      if (f.cells) { // adjacent to the matched group (Flood)
        for (const cl of f.cells) for (const [dr, dc] of DIRS4) {
          const r = cl.r + dr, c = cl.c + dc, k = K(r, c);
          if (r < 0 || r >= this.rows || c < 0 || c >= this.cols || seen.has(k) || matched.has(k)) continue;
          seen.add(k);
          const t = this.board[r][c];
          if (t && !t.pop && !this.protectedTile(t) && t.color !== f.color) cands.push({ r, c });
        }
      } else { // board-wide (Converter)
        // prefer targets that don't instantly complete a match — conversion
        // should set up plays, not constantly fire free cascades
        const risky = [];
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
          if (matched.has(K(r, c))) continue; // never steal a tile from a pending cascade
          const t = this.board[r][c];
          if (t && !t.pop && !this.protectedTile(t) && t.color !== f.color) {
            (this.wouldMatchAt(r, c, f.color) ? risky : cands).push({ r, c });
          }
        }
        if (!cands.length) cands.push(...risky); // only cascade when unavoidable
      }
      if (cands.length) {
        const p = cands[Math.floor(this.rng() * cands.length)];
        const t = this.board[p.r][p.c];
        t.color = f.color;
        t.cflash = true; // bright flash marks the conversion
        setTimeout(() => { delete t.cflash; }, 600);
        this.addFx(p.r, p.c, f.cells ? '🌊' : '🔀', 'emoji');
      }
    }
  }

  // gravity-ish: longer falls take a bit more time but gain average speed
  fallDur(dist) {
    return Math.min(CONFIG.FALL_MAX_MS, Math.round(140 + Math.sqrt(Math.max(1, dist)) * 110));
  }

  // Seam for variants: the tile created for each refill slot. r/c are the
  // slot's final board position. Base behaviour: a normal (bomb-chance) tile.
  makeRefillTile(r, c) { return this.makeTile(this.rollRefillColor()); }

  async dropAndFill() {
    let any = false, maxFall = 0;
    for (let c = 0; c < this.cols; c++) {
      let write = this.rows - 1;
      for (let r = this.rows - 1; r >= 0; r--) {
        const t = this.board[r][c];
        if (t && this.gravityFixed(t)) {
          // fixed tile: nothing falls past it — slots left beneath it stay
          // empty, and compaction restarts in the segment above
          write = r - 1;
          continue;
        }
        if (t) {
          if (write !== r) {
            t.fallDist = write - r; // drives per-tile duration + bounce easing
            maxFall = Math.max(maxFall, t.fallDist);
            this.board[write][c] = t; this.board[r][c] = null; any = true;
          }
          write--;
        }
      }
      // Refill EVERY empty slot left in the column. New tiles enter from
      // above the board and drop past gravity-fixed tiles into the gaps
      // beneath them — fixed tiles block FALLING tiles, never incoming
      // fills. (No fixed tiles → empties are the contiguous top segment and
      // this is exactly the old behaviour.)
      const empties = [];
      for (let r = 0; r < this.rows; r++) if (!this.board[r][c]) empties.push(r);
      empties.forEach((r, i) => {
        const t = this.makeRefillTile(r, c);
        t.enter = i - empties.length; // stacked above the board, in order
        t.fallDist = r - t.enter;
        maxFall = Math.max(maxFall, t.fallDist);
        this.board[r][c] = t;
        any = true;
      });
    }
    if (!any) return;
    this.render(); await this.sleep(30);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const t = this.board[r][c];
      if (t && t.enter !== undefined) delete t.enter;
    }
    this.render(); await this.sleep(this.fallDur(maxFall));
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const t = this.board[r][c];
      if (t && t.fallDist !== undefined) delete t.fallDist; // back to snappy swap timing
    }

    // Treasure chests pay out when they reach the bottom row, then the column resettles.
    let collected = false;
    for (let c = 0; c < this.cols; c++) {
      const t = this.board[this.rows - 1][c];
      if (t && t.chest) {
        collected = true;
        this.board[this.rows - 1][c] = null;
        // context-sensitive: hand out moves when the player is running dry,
        // points otherwise
        if (this.movesLeft <= CONFIG.CHEST_LOW_MOVES) {
          this.movesLeft += CONFIG.CHEST_MOVES;
          this.addFx(this.rows - 1, c, `🎁 +${CONFIG.CHEST_MOVES} moves`, 'big');
        } else {
          this.score += CONFIG.CHEST_POINTS;
          this.addFx(this.rows - 1, c, `🎁 +${CONFIG.CHEST_POINTS}`, 'big');
        }
      }
    }
    if (collected) { this.render(); await this.sleep(CONFIG.POP_MS); await this.dropAndFill(); }
  }

  async resolveBoard(swapCells) {
    let cascades = 0;
    while (cascades++ < CONFIG.MAX_CASCADES) {
      const groups = this.findGroups();
      if (!groups.length) break;
      // cascades announce themselves so chains read as a building combo
      if (cascades >= CONFIG.COMBO_CALLOUT_FROM) {
        this.addFx(-0.7, this.cols / 2 - 0.5, `Combo ×${cascades}${cascades >= 4 ? ' 🔥' : ''}`, 'combo');
        if (cascades >= 3) this.doShake(4);
      }
      const res = this.processStep(groups, swapCells, []);
      swapCells = null;
      this.render(); await this.sleep(CONFIG.POP_MS + res.maxDelay);
      this.applyStep(res);
      await this.dropAndFill();
      this.applyFloods(res.floods); // conversions land on the SETTLED board
      await this.sleep(CONFIG.STEP_PAUSE);
    }
  }

  async explodeSeeds(seeds) {
    const res = this.processStep([], null, seeds);
    if (!res.cnt) return;
    this.render(); await this.sleep(CONFIG.POP_MS + res.maxDelay);
    this.applyStep(res);
    await this.dropAndFill();
    await this.resolveBoard(null);
  }

  async endOfMove() {
    if (this.mods.countdown) {
      let ticked = false;
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const t = this.board[r][c];
        if (t && t.special && t.countdown !== null) { t.countdown--; ticked = true; }
      }
      if (ticked) { this.render(); await this.sleep(120); }
    }
    let rounds = 0;
    while (rounds++ < CONFIG.AUTO_EXPLODE_MAX_ROUNDS) {
      const seeds = [];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const t = this.board[r][c];
        if (t && t.special && (this.mods.autoExplode || (t.countdown !== null && t.countdown <= 0))) seeds.push({ r, c });
      }
      if (!seeds.length) break;
      await this.explodeSeeds(seeds);
      if (!this.mods.autoExplode) break; // countdown only ticks once per move
    }
    if (this.mods.chomper) await this.chomperMove();
    if (this.mods.conveyor) await this.rotateEdges();
    if (this.mods.lava) await this.lavaClear();
  }

  // backfill his trail with a fresh tile — leaving a hole meant gravity
  // instantly yanked him back down after any upward step. Trail upgrades
  // (Bomb Trail / Spicy Trail) shape what he leaves behind.
  backfillChomperTrail(r, c) {
    let back;
    if (this.mods.chomperBomb) {
      back = { id: this.tileId++, color: this.rollRefillColor(), special: 'bomb', dir: null,
               countdown: this.mods.countdown ? CONFIG.COUNTDOWN_TIMER_START : null };
    } else {
      back = this.makeTile(this.rollRefillColor());
    }
    if (this.mods.spicyTrail) back.volatile = this.moveNum + 1;
    back.fresh = true;
    setTimeout(() => { delete back.fresh; }, 400);
    this.board[r][c] = back;
  }

  // Chomper: once per player move (never on cascades) each chomper steps one
  // cell in the direction of the last swap — a secret rule, no UI hints — and
  // eats whatever it lands on at full per-piece value. Board edges, chests,
  // other chompers, and marked cells are walls: it stays put that move.
  async chomperMove() {
    if (this.phase !== 'level' || !this.lastSwapDir) return;
    const chompers = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const t = this.board[r][c];
      if (t && t.chomper) chompers.push({ r, c, t });
    }
    if (!chompers.length) return;
    const steps = 1 + this.mods.doubleBite; // Double Bite: extra step+meal per stack
    let moved = false;
    for (const s of chompers) {
      let pos = { r: s.r, c: s.c };
      for (let step = 0; step < steps; step++) {
        let nr = pos.r + this.lastSwapDir.dr, nc = pos.c + this.lastSwapDir.dc;
        if (CONFIG.CHOMPER_WRAP) {
          nr = (nr + this.rows) % this.rows;
          nc = (nc + this.cols) % this.cols;
        } else if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) break;
        const k = K(nr, nc);
        if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k)) break;
        const prey = this.board[nr][nc];
        if (prey && this.protectedTile(prey)) { this.onChomperBlocked(nr, nc, prey); break; } // he can't eat protected pieces
        s.t.chomp = true;
        const tile = s.t;
        setTimeout(() => { delete tile.chomp; this.render(); }, 500);
        if (prey && prey.special) {
          // biting a special sets it off: full explosion, chains, matryoshka,
          // aftershock — everything a normal detonation does. The chomper is
          // blast-proof and moves in afterwards (unless matryoshka left a
          // newborn special in the crater — then he stops here).
          const res = this.processStep([], null, [{ r: nr, c: nc }]);
          if (res.cnt) {
            this.render(); await this.sleep(CONFIG.POP_MS + res.maxDelay);
            this.applyStep(res);
          }
          moved = true;
          if (this.board[nr][nc]) break; // crater occupied — no further steps
          this.board[nr][nc] = s.t;
          this.backfillChomperTrail(pos.r, pos.c);
          pos = { r: nr, c: nc };
          continue;
        }
        if (prey) {
          // full per-piece value, same formula as the tile badges; Gourmet doubles it
          const pts = (1 + (this.mods.boosts[prey.color] || 0)) * this.run.multiplier * (this.mods.gourmet ? 2 : 1);
          this.score += pts;
          const bonus = (this.mods.boosts[prey.color] || 0) > 0 || this.run.multiplier > 1 || this.mods.gourmet;
          this.addFx(nr, nc, `+${pts}`, bonus ? 'gold' : '');
        }
        this.board[nr][nc] = s.t;
        this.backfillChomperTrail(pos.r, pos.c);
        pos = { r: nr, c: nc };
        moved = true;
        if (steps > 1) { this.render(); await this.sleep(160); } // readable multi-step
      }
    }
    if (!moved) return;
    this.render(); await this.sleep(300);
    await this.dropAndFill();      // detonated meals leave craters — refill them
    await this.resolveBoard(null); // backfill/settling can line up cascades
  }

  // Conveyor belt: the whole edge ring shifts one step clockwise — every piece
  // type rides it, no exclusions. Matches it lines up resolve as cascades.
  async rotateEdges() {
    if (this.phase !== 'level' || this.rows < 2 || this.cols < 2) return;
    const ring = [];
    for (let c = 0; c < this.cols; c++) ring.push([0, c]);
    for (let r = 1; r < this.rows; r++) ring.push([r, this.cols - 1]);
    for (let c = this.cols - 2; c >= 0; c--) ring.push([this.rows - 1, c]);
    for (let r = this.rows - 2; r >= 1; r--) ring.push([r, 0]);
    const tiles = ring.map(([r, c]) => this.board[r][c]);
    for (let i = 0; i < ring.length; i++) {
      const [r, c] = ring[(i + 1) % ring.length];
      this.board[r][c] = tiles[i];
    }
    this.render(); await this.sleep(260);
    await this.resolveBoard(null);
  }

  // Floor is lava: melt the whole bottom row as a board effect.
  async lavaClear() {
    if (this.phase !== 'level') return;
    const cells = [];
    for (let c = 0; c < this.cols; c++) {
      const t = this.board[this.rows - 1][c];
      if (t && !this.protectedTile(t)) cells.push({ r: this.rows - 1, c });
    }
    if (!cells.length) return;
    const res = this.processStep([], null, [], cells);
    if (!res.cnt) return;
    this.render(); await this.sleep(CONFIG.POP_MS + res.maxDelay);
    this.applyStep(res);
    await this.dropAndFill();
    await this.resolveBoard(null);
  }

  // would recolouring (r,c) to `color` complete a straight run of 3+?
  wouldMatchAt(r, c, color) {
    const count = (dr, dc) => {
      let n = 0, rr = r + dr, cc = c + dc;
      while (rr >= 0 && rr < this.rows && cc >= 0 && cc < this.cols) {
        const t = this.board[rr][cc];
        if (!t || t.color !== color) break;
        n++; rr += dr; cc += dc;
      }
      return n;
    };
    return count(0, -1) + count(0, 1) >= 2 || count(-1, 0) + count(1, 0) >= 2;
  }

  // Seam for variants: what merging two adjacent specials does. Base:
  // arrow+arrow fuse into a cross; any other pair is the sum of its parts.
  async resolveMerge(a, b, ta, tb) {
    if (ta.special === 'arrow' && tb.special === 'arrow') {
      // Two arrows fuse into a cross at the landing cell: full row + column.
      // The cross REPLACES both arrow effects (even if both cleared the same
      // direction), so the leftover arrow is stripped rather than chained.
      tb.special = 'cross'; tb.dir = null;
      ta.special = null; ta.dir = null; ta.countdown = null;
      await this.explodeSeeds([b]);
    } else {
      // Any other pair: both pieces just activate — the sum of their parts.
      await this.explodeSeeds([a, b]);
    }
  }

  swapTiles(a, b) {
    const t = this.board[a.r][a.c];
    this.board[a.r][a.c] = this.board[b.r][b.c];
    this.board[b.r][b.c] = t;
  }

  // orthogonal always; diagonal only with the Diagonal swap power-up
  isSwappable(a, b) {
    const dr = Math.abs(a.r - b.r), dc = Math.abs(a.c - b.c);
    return (dr + dc === 1) || (this.mods.diagSwap && dr === 1 && dc === 1);
  }

  async trySwap(a, b) {
    if (this.phase !== 'level' || this.busy) return;
    if (!this.isSwappable(a, b)) return;
    if (a.r < 0 || a.r >= this.rows || a.c < 0 || a.c >= this.cols) return;
    if (b.r < 0 || b.r >= this.rows || b.c < 0 || b.c >= this.cols) return;
    if (!this.board[a.r][a.c] || !this.board[b.r][b.c]) return;
    if (this.immovableTile(this.board[a.r][a.c]) || this.immovableTile(this.board[b.r][b.c])) return; // immovable pieces can't be swapped
    this.busy = true;
    this.swapTiles(a, b);
    this.render(); await this.sleep(CONFIG.SWAP_MS);

    // Merging two adjacent specials is colour-agnostic and always a legal move.
    const ta = this.board[a.r][a.c], tb = this.board[b.r][b.c]; // post-swap tiles
    const merge = !!(ta.special && tb.special);

    if (!merge && !this.findGroups().length) {
      this.swapTiles(a, b);
      this.render(); await this.sleep(CONFIG.SWAP_MS);
      // headshake: make "that swap doesn't work" legible
      const t1 = this.board[a.r][a.c], t2 = this.board[b.r][b.c];
      if (t1) t1.wiggle = true;
      if (t2) t2.wiggle = true;
      this.render();
      setTimeout(() => { if (t1) delete t1.wiggle; if (t2) delete t2.wiggle; this.render(); }, 380);
      this.busy = false;
      return;
    }

    this.movesLeft--;
    this.moveNum++;
    if (this.run.picks.some(p => p.id === 'snowball')) this.run.snowball++;
    this.lastSwapDir = { dr: b.r - a.r, dc: b.c - a.c };
    this.refund = false;
    const preMoveScore = this.score;
    if (merge) {
      this.callout('✨ Merge!');
      this.addWave(b.r, b.c, 4, 0);
      this.doShake(10);
      this.emit('onMerge', a, b);
      await this.resolveMerge(a, b, ta, tb);
    } else {
      await this.resolveBoard([a, b]);
    }
    await this.endOfMove();
    if (this.tripleArmed) {
      this.tripleArmed = false;
      const gained = this.score - preMoveScore;
      if (gained > 0) {
        this.score += gained * (CONFIG.TRIPLE_TILE_MULT - 1);
        this.callout(`3️⃣ Move ×${CONFIG.TRIPLE_TILE_MULT}!`);
      }
    }
    if (this.refund) { this.movesLeft++; this.callout('🔄 Free move!'); }
    this.moveScores.push(this.score - preMoveScore);
    if (!this.refund) this.movesUsed++;

    if (!this.findAnyMove()) {
      this.callout('No moves — shuffling');
      await this.sleep(500);
      this.reshuffleBoard();
    }
    this.checkLevelEnd();
    this.warnLowMoves(); // after refunds/chests/lifesaver settle the real count
    this.busy = false;
    this.render();
  }

  /* ------------------------------- Juice -------------------------------- */
  addFx(r, c, text, cls = '') {
    const id = this.fxId++;
    this.fx.push({ id, r, c, text, cls });
    setTimeout(() => { this.fx = this.fx.filter(f => f.id !== id); this.render(); }, 950);
  }
  callout(text, cls = '') {
    const id = this.fxId++;
    this.callouts.push({ id, text, cls });
    this.render();
    setTimeout(() => { this.callouts = this.callouts.filter(f => f.id !== id); this.render(); }, 1500);
  }

  // loud warning each time the final-moves count drops to 3 / 2 / 1
  warnLowMoves() {
    if (this.phase !== 'level') return;
    if (this.movesLeft > 3 || this.movesLeft < 1) { if (this.movesLeft > 3) this.lastWarnedMoves = null; return; }
    if (this.movesLeft === this.lastWarnedMoves) return;
    this.lastWarnedMoves = this.movesLeft;
    this.callout(this.movesLeft === 1 ? '🚨 LAST MOVE!' : `⚠️ ${this.movesLeft} moves left`, 'danger');
  }
  doShake(ampPx = 5) {
    this.shake = ampPx; // px amplitude, fed to the CSS keyframes via --shake-amp
    setTimeout(() => { this.shake = false; this.render(); }, 320);
  }
  // cosmetic particle burst — Math.random on purpose: never touch the seeded
  // gameplay RNG for visuals, or replays desync
  addParticles(r, c, colorIdx) {
    const n = 6 + Math.floor(Math.random() * 3);
    const ids = [];
    for (let i = 0; i < n; i++) {
      const id = this.fxId++;
      ids.push(id);
      const ang = Math.random() * Math.PI * 2;
      const dist = 26 + Math.random() * 34;
      this.fx.push({ id, r, c, kind: 'part', color: colorIdx, dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist });
    }
    setTimeout(() => { this.fx = this.fx.filter(f => !ids.includes(f.id)); this.render(); }, 600);
  }
  // expanding shockwave ring, sized in cells, centred on a cell
  addWave(r, c, sizeCells, delay = 0) {
    const id = this.fxId++;
    this.fx.push({ id, r, c, kind: 'wave', size: sizeCells, delay });
    setTimeout(() => { this.fx = this.fx.filter(f => f.id !== id); this.render(); }, 800 + delay);
  }
}

