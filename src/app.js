/* ============================================================================
   Match-3 Roguelite — PERSISTENT BOARD variant ("Ascent").
   Engine and power-ups are shared: ../shared/engine.js, ../shared/powerups.js
   (loaded before this file — see index.html). This file owns: CONFIG, the
   variant's telemetry storage, the variant remaps of shared power-ups, the
   PersistentGame subclass (checkpoint run flow + per-move drip), and the UI.

   Variant rules recap: ONE board per run (never regenerates), one run-long
   bar with cumulative score checkpoints — crossing pays moves + a draft;
   endless score chase past the final flag; loss only at 0 moves.
   NEVER edit shared/* for variant-only behaviour — override here instead.
   ========================================================================== */
'use strict';

const CONFIG = {
  // Stamped into every telemetry record so balance passes only compare runs
  // played on the same rules. Bump when mechanics or targets change.
  BALANCE_VERSION: 8, // v8: snowball split into Snow crusher (specials) + Snow painter (boosted matches), shared bar, +3/charge
  VARIANT: 'persistent',           // stamped into telemetry so datasets never mix

  // Hard ceiling on BANKED moves (movesLeft can never exceed this). Grants,
  // refunds, momentum, chests, fusion all clip at the cap — you can still
  // play endlessly if you keep earning, but you're never more than this many
  // moves from death. v6: 20 → 16 (Omri: still too little danger); with the
  // v6 grants (max 13) a tight crossing still fits, stacked surpluses don't.
  MAX_MOVES: 16,
  SQUARE_BONUS_POINTS: 10,         // square bonus upgrade: flat points per square match
  CHOMPER_WRAP: true,  // edges wrap Pac-Man style; false = stay in place at edges

  // Remote telemetry sink — SHARED table with the base game (records separate
  // by payload->>variant). Publishable key — safe to ship. Both empty = off.
  TELEMETRY_ENDPOINT: 'https://dqrolnmswommvfsdwogf.supabase.co/rest/v1/telemetry',
  TELEMETRY_KEY: 'sb_publishable_C_G7S8iEfCnTtvWJdXxIrA_8YSuqAcG',

  // Run structure — cumulative score checkpoints along one run-long bar.
  // v3 retune from telemetry (72 segments, 6 testers): surplus moves CARRY on
  // a persistent board, so grants track observed per-segment need and the
  // middle checkpoints rose ~10%. Victory-lap grant halved (endless economy
  // self-extends: refunds/momentum/chests stretched 16 into 40-60-move laps).
  CHECKPOINTS: [80, 250, 520, 900, 1500, 2500],
  START_MOVES: 10,                 // opening move pool
  // v6: grants cut again (Omri: checkpoint move rewards still too generous) —
  // each segment's grant now sits ~2 under its observed median moves-used,
  // so banked surplus + refunds/momentum have to cover the difference.
  CHECKPOINT_MOVES: [8, 10, 11, 12, 13, 6], // granted on crossing checkpoint i (last = victory lap)
  DRAFT_OPTIONS: 3,                // 2 or 3 — also toggleable in the UI

  // Per-move drip spawns — replaces the base game's per-level seeding of
  // special cells/chests. After every move, each owned type rolls once
  // (seeded RNG); caps bound how many exist at once, pity timers guarantee
  // a spawn after too many dry moves. Rates ≈ base-game per-level density.
  // (Xtra-move marks don't drip: exactly 1 mark per pick lives on the board
  // at all times — consuming one respawns another the same move.)
  DRIP: {
    pinata: { chance: 0.15, pity: 12, cap: 2 },
    chest:  { chance: 0.15, pity: 12, cap: 2 },  // counts board + queued
    triple: { chance: 0.08, pity: 20, cap: 1 },
  },

  // Board
  BOARD_COLS: 7,
  BOARD_ROWS: 7,
  COLOURS: 5,
  MAX_BOARD: 10,                   // hard cap for the Expand power-up

  // Target scaling per colour count (applies to every checkpoint value).
  COLOUR_TARGET_SCALE: { 5: 1, 6: 0.85 },

  // Draft gating by draft NUMBER (1 = the run-start draft, then +1 per
  // checkpoint crossed) — same cadence as the base game's per-level gates.
  // Legendaries never sit in the normal pool — from LEGENDARY_FROM_LEVEL each
  // draft has LEGENDARY_SLOT_CHANCE to dedicate one slot to a legendary.
  STRONG_POWERUPS_FROM_LEVEL: 3,
  LEGENDARY_FROM_LEVEL: 5,
  LEGENDARY_SLOT_CHANCE: 0.35,

  // Rarity: a pick's base weight is CLUSTER_WEIGHT_MASS / (available picks in
  // its cluster), clamped — big clusters stop flooding drafts, small ones
  // surface. Unlocked upgrade picks (boost/square/chomper families) get
  // UPGRADE_WEIGHT so investing in a parent actually shows you its upgrades.
  CLUSTER_WEIGHT_MASS: 10,
  WEIGHT_MIN: 0.6,
  WEIGHT_MAX: 2.0,
  UPGRADE_WEIGHT: 2,

  MERGE_BONUS_MOVES: 1,            // fusion energy: moves granted per special merge
  MOMENTUM_BASE: 3,                // v6: 5 → 3 — 4+ matches needed to fill the momentum bar
  MOMENTUM_MIN: 2,                 // bar floor no matter how many stacks

  // Special piece spawn thresholds
  MATCH_4_SPAWNS: 'arrow',
  MATCH_5_SPAWNS: 'lightning',
  MATCH_SHAPE_SPAWNS: 'bomb',     // L or T shape

  // Power-up tuning
  BOMB_CHANCE_PER_PICK: 0.05,      // 5% per pick, cumulative
  SPECIAL_SPAWNER_CHANCE: 0.40,    // 40% chance on boosted-colour match, per pick
  FILL_UP_THRESHOLD: 40,           // boosted tiles matched per multiplier step
  LIFESAVER_BONUS_MOVES: 3,
  SNOWBALL_MOVES_PER_POINT: 2,     // shared-roster compat (old snowball is disabled here)
  // v8 snowball rework: one shared bar, charged by two separate picks
  // (specials destroyed / boosted matches). Each full bar: +3 to every
  // match you make, forever — earned, not passive.
  SNOWBALL_BAR: 5,                 // charge units per bar fill
  SNOWBALL_BONUS_STEP: 3,          // bonus added to the per-match payout per fill
  COUNTDOWN_BASE: 2,               // v6: fuse with ONE countdown pick; a second pick shortens it (see the getter below)
  BLAST_RADIUS_BONUS: 1,           // extra rings added to bomb explosion, per pick
  MAX_BOMB_RADIUS: 3,
  SPAWN_WEIGHT_PER_PICK: 0.5,      // extra refill weight on boosted colours, per pick (base weight 1)
  TEMPO_MULT: 3,                   // score multiplier on the first match after each checkpoint
  CHEST_POINTS: 30,                // chest reward when moves aren't scarce
  CHEST_MOVES: 2,                  // chest reward when running low on moves
  CHEST_LOW_MOVES: 4,              // "low" = this many moves left or fewer
  PINATA_HITS: 5,                  // clears over a piñata cell to crack it
  PINATA_POINTS: 50,               // payout per cracked piñata
  TRIPLE_TILE_MULT: 3,             // whole-move multiplier when triggered
  // Shared-roster compat only — the fork's variant remaps below replace the
  // hooks/descs that read these; kept so unpatched shared code never sees
  // undefined if the base roster grows new references.
  XTRA_MOVE_TILES_PER_LEVEL: 5,
  CHEST_COUNT: 2,
  PINATA_TILES: 2,
  TRIPLE_TILES: 1,

  // Draft weighting
  SYNERGY_CLUSTER_WEIGHT: 0.6,     // weight += this per already-picked power-up in the same cluster
  BOOST_SAME_COLOUR_CHANCE: 0.6,   // chance a new Colour boost offer re-rolls an existing colour

  // Safety / pacing
  AUTO_EXPLODE_MAX_ROUNDS: 1,
  MAX_CASCADES: 30,

  // Animation timings (ms)
  SWAP_MS: 150, POP_MS: 220, FALL_MS: 240, STEP_PAUSE: 40,
  FALL_MAX_MS: 400,
  BOOM_STAGGER_MS: 35,
  LINE_STAGGER_MS: 22,
  CHAIN_STAGGER_MS: 90,
  COMBO_CALLOUT_FROM: 2,
};

// Set by the PersistentGame constructor; lets CONFIG getters and roster
// patches read live run state (one game instance per page).
let ACTIVE_GAME = null;

// v6 countdown rework: the fuse is DYNAMIC — 2 with one Countdown pick, 1
// with two (a 1-move fuse detonates at the end of the move the special
// spawned in, which is the old Auto-explode). The shared engine reads
// CONFIG.COUNTDOWN_TIMER_START at every spawn site (makeTile, makeSpecial,
// matryoshka), so a getter covers them all without touching shared/*.
Object.defineProperty(CONFIG, 'COUNTDOWN_TIMER_START', {
  get() {
    const n = ACTIVE_GAME && ACTIVE_GAME.run ? ACTIVE_GAME.run.picks.filter(p => p.id === 'countdown').length : 1;
    return Math.max(1, CONFIG.COUNTDOWN_BASE - Math.max(0, n - 1));
  },
});

/* --------------------- Variant telemetry storage --------------------------
   The shared helpers are bound to the base game's localStorage key, so the
   fork reassigns them (they're plain function declarations = writable
   globals). Own key = datasets never mix even on the same browser; records
   are one per checkpoint SEGMENT and carry variant:'persistent'. */
const P_TELEMETRY_KEY = 'rl_persistent_telemetry_v1';
telemetryAll = function () {
  try { return JSON.parse(localStorage.getItem(P_TELEMETRY_KEY)) || []; } catch (e) { return []; }
};
telemetrySave = function (rec) {
  try {
    const all = telemetryAll();
    all.push(rec);
    while (all.length > TELEMETRY_MAX_RECORDS) all.shift();
    localStorage.setItem(P_TELEMETRY_KEY, JSON.stringify(all));
  } catch (e) { /* storage unavailable — prototype keeps playing */ }
  if (!rec.fast) telemetrySend(rec); // bot/test runs stay local-only
};
telemetryClear = function () {
  try { localStorage.removeItem(P_TELEMETRY_KEY); } catch (e) {}
};
telemetrySummary = function (includeBot = false, version = null) {
  const recs = telemetryAll().filter(r => (includeBot || !r.fast) && (version === null || r.v === version));
  const byLevel = {};
  for (const r of recs) {
    const b = byLevel[r.level] || (byLevel[r.level] = { level: r.level, plays: 0, clears: 0, ppm: 0, score: 0, target: 0 });
    b.plays++; if (r.result === 'clear') b.clears++;
    b.ppm += r.ppm; b.score += r.score; b.target += r.target;
  }
  return Object.values(byLevel).sort((a, b) => a.level - b.level).map(b => ({
    level: b.level, plays: b.plays,
    clearRate: +(b.clears / b.plays).toFixed(2),
    avgPtsPerMove: +(b.ppm / b.plays).toFixed(1),
    avgScore: Math.round(b.score / b.plays),
    target: Math.round(b.target / b.plays), // segment delta, from the records themselves
  }));
};

/* ----------------------- Variant power-up remaps ---------------------------
   Runtime patches on the SHARED roster (never edit shared/powerups.js for
   these). Level-seeded cells/chests become per-move drips; xtra-move marks
   become a constant-count respawn. After these deletions, the only remaining
   onLevelStart hooks are spawn-once critters (chomper family) — the variant
   fires those once per run / on pick, never per checkpoint. */
Object.assign(POWERUPS.xtramove, {
  desc: () => 'One 🔄 cell is always on the board; matching over it refunds the move, and a new one pops up elsewhere (stacks: +1 cell each, max 1 refund per move)',
  mods(m) { m.marks += 1; }, // m.marks = how many marks live on the board at once
});
Object.assign(POWERUPS.pinata, {
  desc: () => `Piñatas appear as you play (up to ${CONFIG.DRIP.pinata.cap}); ${CONFIG.PINATA_HITS} matches over one pays +${CONFIG.PINATA_POINTS} points (cascades count)`,
  mods(m) { m.pinataDrip = true; },
});
delete POWERUPS.pinata.onLevelStart;
Object.assign(POWERUPS.tripletile, {
  desc: () => `A marked tile appears as you play; matching over it makes the whole move score ×${CONFIG.TRIPLE_TILE_MULT} (then a new one drips in later)`,
  mods(m) { m.tripleDrip = true; },
});
delete POWERUPS.tripletile.onLevelStart;
Object.assign(POWERUPS.chests, {
  desc: () => `Chests drop in from the top as you play — at the bottom they pay +${CONFIG.CHEST_POINTS} points, or +${CONFIG.CHEST_MOVES} moves when you're low`,
  mods(m) { m.chestDrip = true; },
});
delete POWERUPS.chests.onLevelStart;
POWERUPS.expandrow.desc = () => 'Board grows by one row, immediately (stacks)';
POWERUPS.expandcol.desc = () => 'Board grows by one column, immediately (stacks)';

// v6 roster cuts (this variant only):
POWERUPS.tempo.disabled = true;       // removed from the pool (Omri, 2026-08-26)
POWERUPS.autoexplode.disabled = true; // superseded by stacked Countdown (below)

// v6 Countdown: 2-move fuse, stacks ONCE — the second pick shortens the fuse
// to 1, which detonates specials the move they spawn (the old Auto-explode).
// `stackable` is kept truthful in computeMods (false again after 2 picks).
Object.assign(POWERUPS.countdown, {
  stackable: true,
  desc: () => ACTIVE_GAME && ACTIVE_GAME.run && ACTIVE_GAME.run.picks.some(p => p.id === 'countdown')
    ? 'Shorten the fuse to 1 move — specials explode the move they spawn'
    : `Specials get a ${CONFIG.COUNTDOWN_BASE}-move fuse, then explode on their own (stacks once: a second pick shortens the fuse to 1)`,
});

// v6 Fill-up: one CHARGE per pick — the battery fills once (40 boosted
// tiles → ×2) then turns off; stacking buys another charge toward ×3.
// The group._fillCounted guard keeps stacked picks from double-counting
// tiles (the shared emit calls onMatch once per pick).
Object.assign(POWERUPS.fillup, {
  stackable: true,
  desc: () => `Every ${CONFIG.FILL_UP_THRESHOLD} boosted tiles matched: run multiplier +1 — one charge; stack it to work up to ×3`,
  onMatch(g, p, group) {
    if (!g.mods.boosts[group.color] || group._fillCounted) return;
    group._fillCounted = true;
    const charges = g.run.picks.filter(x => x.id === 'fillup').length;
    if (g.run.fillTriggers >= charges) return; // battery spent — stops counting
    g.run.fillCount += group.cells.length;
    while (g.run.fillTriggers < charges && g.run.fillCount >= CONFIG.FILL_UP_THRESHOLD * (g.run.fillTriggers + 1)) {
      g.run.fillTriggers++; g.run.multiplier++;
      g.callout(`🔋 Multiplier ×${g.run.multiplier}!${g.run.fillTriggers >= charges ? ' (battery spent)' : ''}`);
    }
  },
});

// v8 Snowball rework: the old passive pick (bonus grew by itself every 2
// moves — trivial value, an auto-pick early) splits into two EARNED chargers
// feeding ONE bar (run.snowCharge, size SNOWBALL_BAR). Each full bar:
// run.snowBonus += SNOWBALL_BONUS_STEP, paid on every match you make.
POWERUPS.snowball.disabled = true; // replaced by the split below
// Payout helper — both picks call it; the group flag stops double-pay when
// both (or stacked copies) are owned, since emit fires onMatch once per pick.
function snowballPayout(g, group, api) {
  if (group.active && g.run.snowBonus > 0 && !group._snowPaid) {
    group._snowPaid = true;
    api.addBonus(g.run.snowBonus);
  }
}
POWERUPS.snowcrush = {
  id: 'snowcrush', name: 'Snow crusher', icon: '❄️', cluster: 'chaos', stackable: true, tier: 1,
  desc: () => `Every ${CONFIG.SNOWBALL_BAR} special pieces destroyed charge the snowball — each charge adds +${CONFIG.SNOWBALL_BONUS_STEP} bonus points to every match you make (stacks: each pick makes specials count once more)`,
  mods(m) { m.snowCrush = (m.snowCrush || 0) + 1; }, // charge per special = picks
  onMatch(g, p, group, api) { snowballPayout(g, group, api); },
};
POWERUPS.snowpaint = {
  id: 'snowpaint', name: 'Snow painter', icon: '⛄', cluster: 'colour', stackable: false, tier: 1, requiresBoost: true,
  desc: () => `Boosted-colour matches you make charge the snowball — each full bar adds +${CONFIG.SNOWBALL_BONUS_STEP} bonus points to every match you make`,
  mods(m) { m.snowPaint = true; },
  onMatch(g, p, group, api) {
    if (group.active && g.mods.boosts[group.color] && !group._snowCounted) {
      group._snowCounted = true;
      g.snowChargeAdd(1);
    }
    snowballPayout(g, group, api);
  },
};
POWERUP_LIST.push(POWERUPS.snowcrush, POWERUPS.snowpaint); // shared list is built at load time

// v7 Spicy Trail: scorch PERSISTS until matched (shared engine gives it a
// 1-move expiry, which made triggering it nearly impossible — you'd need a
// match through one specific fresh tile on the very next move). Chomper now
// paints a burning wake; each scorched tile is a stored + blast that pays
// once (the engine zeroes `volatile` on trigger). Aftershock keeps its own
// 1-move scorch — this only touches the trail. Override is in
// PersistentGame.backfillChomperTrail below.
POWERUPS.spicytrail.desc = () => 'Tiles Chomper leaves behind stay scorched until matched — matching one sets off a small blast';

// v6 Blast radius: only offered once something in the build MAKES bombs
// (Bomb chance / Square bomb / Bomb trail) — a bigger boom needs a bomb
// source beyond lucky L/T matches. Dynamic `disabled` keeps this out of
// shared makeOffers.
Object.defineProperty(POWERUPS.blast, 'disabled', {
  get() {
    const m = ACTIVE_GAME && ACTIVE_GAME.mods;
    return !(m && (m.bombChance > 0 || m.squareBomb || m.chomperBomb));
  },
});

/* ========================== PERSISTENT GAME ================================
   Subclass seams (called by the shared engine):
     startLevel   — pickOffer lands here after every draft: first pick builds
                    THE board (startRun), later picks resume it live
     checkLevelEnd — checkpoint crossings / loss / endless-win
     continueRun  — checkpoint overlay → next draft
     logLevel     — one telemetry record per checkpoint segment
     endOfMove    — per-move drip spawns ride the engine's move tail
     makeRefillTile — queued drip chests ride in as refill tiles
   ========================================================================== */
class PersistentGame extends Game {
  constructor(onRender) {
    super(onRender);
    ACTIVE_GAME = this; // CONFIG getters + roster patches read live run state
    this.marks = new Set();
    this.drip = { pinata: 0, chest: 0, triple: 0 }; // dry-move pity counters
    this.pendingChests = 0;      // chests queued to ride in on the next refill
    this.segPeak = 0; this.segClipped = 0; this.segDanger = 0; // cap telemetry, per segment
  }

  // Countdown stacks exactly once: after the 2nd pick it leaves the pool.
  computeMods() {
    super.computeMods();
    POWERUPS.countdown.stackable = this.run.picks.filter(p => p.id === 'countdown').length < 2;
  }

  // v5 moves cap: every source of moves — checkpoint grants, mark refunds,
  // momentum, chests, fusion, lifesaver, cheats — assigns through here, so
  // the ceiling holds without touching shared/*. Clips only on gains.
  get movesLeft() { return this._movesLeft || 0; }
  set movesLeft(v) {
    const cap = CONFIG.MAX_MOVES || Infinity;
    if (v > cap) {
      if (v > (this._movesLeft || 0)) { // a gain got clipped — surface it
        this.segClipped += v - cap;
        this.callout('👟 MAX moves!');
      }
      v = cap;
    }
    this._movesLeft = v;
    if (v > this.segPeak) this.segPeak = v;
  }

  newRun(seed) {
    this.seed = (seed >>> 0) || 1;
    this.rng = mulberry32(this.seed);
    // run.level = draft number (1 at run start, +1 per checkpoint) — it
    // drives tier gating and keeps the base game's draft cadence.
    this.run = { level: 0, picks: [], draftHistory: [], snowball: 0, momentum: 0,
                 snowCharge: 0, snowBonus: 0, // v8 snowball bar (shared by both charger picks)
                 fillCount: 0, fillTriggers: 0, multiplier: 1, lifesaverUsed: false,
                 checkpointIdx: 0, finalReached: false, pendingDrafts: 0, segmentsLogged: 0 };
    this.board = null;
    this.score = 0;
    this.busy = false;
    this.computeMods();
    this.startDraft();
  }

  // Checkpoint values, colour-scaled (cumulative run score, not per-segment).
  checkpoints() {
    const s = CONFIG.COLOUR_TARGET_SCALE[this.opts.colours] || 1;
    return CONFIG.CHECKPOINTS.map(v => Math.round(v * s));
  }

  // Shared pickOffer calls startLevel after every pick — the variant
  // dispatcher. Mid-run picks mutate the LIVE board; no regeneration, ever.
  startLevel() {
    if (!this.board) { this.startRun(); return; }
    const pick = this.run.picks[this.run.picks.length - 1];
    this.growBoard();
    this.dripSeedFor(pick); // new drip power-ups land their first spawn instantly
    const def = POWERUPS[pick.id];
    if (def.onLevelStart) def.onLevelStart(this, pick); // spawn-once hooks (chomper family)
    // One move can cross several checkpoints at once — settle every owed draft.
    this.run.pendingDrafts = Math.max(0, this.run.pendingDrafts - 1);
    if (this.run.pendingDrafts > 0) { this.startDraft(); return; }
    if (!this.findAnyMove()) this.reshuffleBoard();
    this.phase = 'level';
    this.busy = false;
    this.render();
  }

  // The run's single board generation — everything after this mutates in place.
  startRun() {
    this.rows = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_ROWS + this.mods.expandRows);
    this.cols = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_COLS + this.mods.expandCols);
    this.movesLeft = CONFIG.START_MOVES;
    this.segPeak = this.movesLeft; this.segClipped = 0; this.segDanger = 0;
    this.lastWarnedMoves = null;
    this.score = 0;
    this.segStartScore = 0;  // telemetry: score at the current segment's start
    this.movesUsed = 0; this.moveScores = []; // per segment, reset on each log
    this.moveNum = 0;        // 1-based during a move; drives Snowball and Aftershock expiry
    this.tempoUsed = false;  // Tempo's ×N is armed until the first match after each checkpoint
    this.genBoard();
    this.marks = new Set();
    this.pinatas = new Map(); this.triples = new Set(); this.tripleArmed = false;
    this.drip = { pinata: 0, chest: 0, triple: 0 };
    this.pendingChests = 0;
    this.lastSwapDir = null;
    this.emit('onLevelStart'); // post-remap this is spawn-once hooks only (chomper family)
    this.dripSeedFor(this.run.picks[0]);
    if (!this.findAnyMove()) this.reshuffleBoard(); // placed pieces can rarely kill the only move
    this.phase = 'level';
    this.busy = false;
    this.render();
  }

  // Expand picks grow the live board: rows append at the BOTTOM, columns at
  // the RIGHT, so existing cell keys (marks/piñatas/triples) stay valid.
  // New tiles roll match-avoiding colours, so growth never fires a free cascade.
  growBoard() {
    const wantRows = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_ROWS + this.mods.expandRows);
    const wantCols = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_COLS + this.mods.expandCols);
    while (this.rows < wantRows) {
      this.board.push(Array(this.cols).fill(null));
      this.rows++;
      const r = this.rows - 1;
      for (let c = 0; c < this.cols; c++) this.board[r][c] = this.makeTile(this.rollColorAvoidingMatches(r, c), true);
    }
    while (this.cols < wantCols) {
      this.cols++;
      for (let r = 0; r < this.rows; r++) this.board[r].push(null);
      const c = this.cols - 1;
      for (let r = 0; r < this.rows; r++) this.board[r][c] = this.makeTile(this.rollColorAvoidingMatches(r, c), true);
    }
  }

  continueRun() {
    if (this.phase !== 'checkpoint') return;
    this.startDraft();
  }

  // Engine trySwap calls this once per resolved player move — drip spawns
  // ride the move tail so cheats/board effects never advance the economy.
  async endOfMove() {
    await super.endOfMove();
    if (this.phase === 'level') {
      this.dripRolls();
      if (this.movesLeft <= 3) this.segDanger++; // moves played under the gun (cap-tuning telemetry)
    }
  }

  // Replaces per-level clear/loss: cross every checkpoint the score now
  // clears (grant moves + queue drafts), otherwise check for run end.
  checkLevelEnd() {
    if (this.phase !== 'level') return;
    const cps = this.checkpoints();
    let crossed = 0, granted = 0;
    while (this.run.checkpointIdx < cps.length && this.score >= cps[this.run.checkpointIdx]) {
      const i = this.run.checkpointIdx++;
      const grant = CONFIG.CHECKPOINT_MOVES[Math.min(i, CONFIG.CHECKPOINT_MOVES.length - 1)];
      const before = this.movesLeft;
      this.movesLeft += grant;
      granted += this.movesLeft - before; crossed++; // overlay shows what the cap actually let through
      this.logLevel('clear');
      this.run.pendingDrafts++;
      this.tempoUsed = false; // Tempo re-arms for the new segment
      if (this.run.checkpointIdx >= cps.length) this.run.finalReached = true;
    }
    if (crossed) {
      this.lastCheckpoint = { n: this.run.checkpointIdx, crossed, moves: granted, final: this.run.finalReached };
      this.phase = 'checkpoint';
      return;
    }
    if (this.movesLeft <= 0) {
      if (this.mods.lifesaver && !this.run.lifesaverUsed) {
        this.run.lifesaverUsed = true;
        this.movesLeft += CONFIG.LIFESAVER_BONUS_MOVES;
        this.callout(`🛟 Lifesaver! +${CONFIG.LIFESAVER_BONUS_MOVES} moves`);
      } else {
        this.logLevel(this.run.finalReached ? 'end' : 'loss');
        this.phase = this.run.finalReached ? 'win' : 'loss';
      }
    }
  }

  // One record per checkpoint SEGMENT (score/moves are deltas within it).
  logLevel(result) {
    const seg = ++this.run.segmentsLogged;
    const cps = this.checkpoints();
    const targetAbs = cps[Math.min(seg - 1, cps.length - 1)];
    const segScore = this.score - this.segStartScore;
    telemetrySave({
      t: Date.now(), seed: this.seed, level: seg, result, // level = segment number
      target: Math.max(0, targetAbs - this.segStartScore), // points this segment needed
      score: segScore, totalScore: this.score,
      movesUsed: this.movesUsed,
      ppm: +(segScore / Math.max(1, this.movesUsed)).toFixed(1),
      moveScores: this.moveScores.slice(),
      picks: this.run.picks.map(p => p.id + (p.color !== undefined ? ':' + p.color : '')),
      draft: this.run.draftHistory[seg - 1] || null, // the draft that opened this segment
      rows: this.rows, cols: this.cols, draftOptions: this.opts.draftOptions,
      colours: this.opts.colours, v: CONFIG.BALANCE_VERSION, variant: CONFIG.VARIANT,
      // cap tuning (v5): highest bank seen, moves lost to MAX_MOVES, and
      // moves played at ≤3 left — see handover §telemetry for the tuning rule
      peakBank: this.segPeak, clipped: this.segClipped, dangerMoves: this.segDanger,
      snowBonus: this.run.snowBonus, // v8: snowball payout level at segment end
      fast: !!this.fast, // bot/test runs — excluded from human summaries
    });
    this.segStartScore = this.score;
    this.movesUsed = 0; this.moveScores = [];
    this.segPeak = this.movesLeft; this.segClipped = 0; this.segDanger = 0;
  }

  // v8 snowball bar: charge units from either charger pick; each full bar
  // permanently raises the per-match bonus. Overflow carries.
  snowChargeAdd(n) {
    this.run.snowCharge += n;
    while (this.run.snowCharge >= CONFIG.SNOWBALL_BAR) {
      this.run.snowCharge -= CONFIG.SNOWBALL_BAR;
      this.run.snowBonus += CONFIG.SNOWBALL_BONUS_STEP;
      this.callout(`❄️ Snowball +${CONFIG.SNOWBALL_BONUS_STEP} — now +${this.run.snowBonus}/match!`);
    }
  }

  // Snow crusher counts every special DESTROYED (matches, chains, chomper
  // bites — anything that clears through processStep). applyStep sees the
  // cleared set while the tiles are still on the board.
  applyStep(res) {
    if (this.mods.snowCrush) {
      let n = 0;
      for (const { r, c } of res.cleared.values()) {
        const t = this.board[r][c];
        if (t && t.special) n++;
      }
      if (n) this.snowChargeAdd(n * this.mods.snowCrush);
    }
    super.applyStep(res);
  }

  // v7 Spicy Trail: the trail tile's scorch never expires (Infinity beats the
  // engine's `volatile >= moveNum` check on every move) — consumed on trigger.
  backfillChomperTrail(r, c) {
    super.backfillChomperTrail(r, c);
    const t = this.board[r][c];
    if (this.mods.spicyTrail && t && t.volatile) t.volatile = Infinity;
  }

  // Queued drip chests ride in as the topmost refill tile of a column.
  makeRefillTile(r, c) {
    if (r === 0 && this.pendingChests > 0) {
      this.pendingChests--;
      return { id: this.tileId++, color: -1, chest: true, special: null, dir: null, countdown: null };
    }
    return super.makeRefillTile(r, c);
  }

  /* --------------------------- Per-move drip -----------------------------
     Replaces per-level seeding: after every player move, each owned type
     rolls once against CONFIG.DRIP — capped concurrency, pity after too
     many dry moves. Seeded RNG, so replays stay deterministic. */
  chestsInPlay() {
    let n = this.pendingChests;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++)
      if (this.board[r][c] && this.board[r][c].chest) n++;
    return n;
  }

  dripRolls() {
    const D = CONFIG.DRIP;
    const roll = (name, below, chance, spawn) => {
      if (!below) { this.drip[name] = 0; return; }
      if (this.rng() < chance || this.drip[name] >= D[name].pity) {
        if (spawn()) { this.drip[name] = 0; return; }
      }
      this.drip[name]++;
    };
    // Xtra-move marks don't roll: exactly one per pick lives on the board, so
    // a consumed mark pops back up (elsewhere) the same move it was used.
    while (this.marks.size < this.mods.marks) { if (!this.spawnMark()) break; }
    if (this.mods.pinataDrip)
      roll('pinata', this.pinatas.size < D.pinata.cap, D.pinata.chance, () => this.spawnPinata());
    if (this.mods.tripleDrip)
      roll('triple', this.triples.size < D.triple.cap, D.triple.chance, () => this.spawnTriple());
    if (this.mods.chestDrip)
      roll('chest', this.chestsInPlay() < D.chest.cap, D.chest.chance,
           () => { this.pendingChests++; return true; }); // rides in on the next refill
  }

  // First spawn lands the moment the power-up is picked, so the pick feels live.
  dripSeedFor(pick) {
    if (!pick) return;
    if (pick.id === 'xtramove') this.spawnMark();
    else if (pick.id === 'pinata') this.spawnPinata();
    else if (pick.id === 'tripletile') this.spawnTriple();
    else if (pick.id === 'chests') this.pendingChests++;
  }

  spawnMark() {
    let guard = 0;
    while (guard++ < 300) {
      const r = Math.floor(this.rng() * this.rows), c = Math.floor(this.rng() * this.cols);
      // edges are fine for xtra-move marks, corners are not (too few matches reach them)
      if ((r === 0 || r === this.rows - 1) && (c === 0 || c === this.cols - 1)) continue;
      const k = K(r, c);
      if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k)) continue;
      this.marks.add(k);
      this.addFx(r, c, '🔄', 'emoji');
      return true;
    }
    return false;
  }

  spawnPinata() {
    let guard = 0;
    while (guard++ < 300) {
      const k = this.rollInteriorCell(); // never on the board edge
      if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k)) continue;
      this.pinatas.set(k, CONFIG.PINATA_HITS);
      const [r, c] = k.split(',').map(Number);
      this.addFx(r, c, '🪅', 'emoji');
      return true;
    }
    return false;
  }

  spawnTriple() {
    let guard = 0;
    while (guard++ < 300) {
      const k = this.rollInteriorCell(); // never on the board edge
      if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k)) continue;
      this.triples.add(k);
      const [r, c] = k.split(',').map(Number);
      this.addFx(r, c, `✖${CONFIG.TRIPLE_TILE_MULT}`, 'emoji');
      return true;
    }
    return false;
  }
}

/* ================================== UI ==================================== */
const h = htm.bind(React.createElement);

function useCellSize(cols) {
  // board sizes to the phone frame (.phone, 402px), not the raw viewport
  const calc = () => Math.max(30, Math.min(56, Math.floor((Math.min(window.innerWidth, 402) - 28) / cols)));
  const [s, setS] = React.useState(calc);
  React.useEffect(() => {
    const f = () => setS(calc());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [cols]);
  return s;
}

function buildChips(G) {
  const chips = [], byKey = new Map();
  for (const p of G.run.picks) {
    const def = POWERUPS[p.id];
    const k = p.id + (p.color !== undefined ? ':' + p.color : '');
    if (byKey.has(k)) byKey.get(k).count++;
    else { const ch = { key: k, def, pick: p, count: 1 }; byKey.set(k, ch); chips.push(ch); }
  }
  return chips;
}

function Toggle({ G }) {
  return h`<button className="toggle" onClick=${() => { G.opts.draftOptions = G.opts.draftOptions === 2 ? 3 : 2; G.render(); }}>
    Draft picks: <b>${G.opts.draftOptions}</b> (tap to switch)
  </button>`;
}

function ColourToggle({ G }) {
  return h`<button className="toggle" onClick=${() => { G.opts.colours = G.opts.colours === 5 ? 6 : 5; G.render(); }}>
    Colours: <b>${G.opts.colours}</b>${G.opts.colours === 6 ? h` <span className="dot bg5"></span>` : null} (tap to switch)
  </button>`;
}

function StatsPanel() {
  const [open, setOpen] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [exported, setExported] = React.useState(false);
  const [dl, setDl] = React.useState(null);
  const [, bump] = React.useReducer(x => x + 1, 0);
  // On claude.ai the page can offer play data as a file download (much more
  // reliable than clipboard inside the artifact iframe). null = hide button.
  React.useEffect(() => {
    let live = true;
    if (window.claude && window.claude.use) {
      window.claude.use('downloads').then(ns => { if (live) setDl(ns); }).catch(() => {});
    }
    return () => { live = false; };
  }, []);
  const human = telemetryAll().filter(r => !r.fast);
  if (!human.length) return null;
  const rows = telemetrySummary();
  const [showRaw, setShowRaw] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(telemetryAll())); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch (e) { setShowRaw(true); } // clipboard blocked (e.g. embedded page) — show selectable JSON instead
  };
  const exportFile = async () => {
    try {
      await dl.save({
        filename: `match3-playdata-${new Date().toISOString().slice(0, 10)}.json`,
        data: JSON.stringify(telemetryAll()),
      });
      setExported(true); setTimeout(() => setExported(false), 2000);
    } catch (e) { /* declined / rate-limited — viewer's call, no retry */ }
  };
  return h`<div className="stats">
    <button className="toggle" onClick=${() => setOpen(!open)}>📊 Session stats — ${human.length} segments logged</button>
    ${open ? h`<div className="stats-body">
      <table>
        <thead><tr><th>Seg</th><th>plays</th><th>clear%</th><th>pts/move</th><th>avg score</th><th>target</th></tr></thead>
        <tbody>${rows.map(r => h`<tr key=${r.level}>
          <td>${r.level}</td><td>${r.plays}</td><td>${Math.round(r.clearRate * 100)}%</td>
          <td>${r.avgPtsPerMove}</td><td>${r.avgScore}</td><td>${r.target}</td>
        </tr>`)}</tbody>
      </table>
      <div className="stats-buttons">
        ${dl ? h`<button onClick=${exportFile}>${exported ? '✅ Exported' : '⬇️ Export play data'}</button>` : null}
        <button onClick=${copy}>${copied ? '✅ Copied' : 'Copy JSON'}</button>
        <button onClick=${() => { if (confirm('Clear all logged play data?')) { telemetryClear(); bump(); } }}>Clear</button>
      </div>
      ${showRaw ? h`<textarea className="rawdata" readOnly value=${JSON.stringify(telemetryAll())}
        onFocus=${e => e.target.select()} onClick=${e => e.target.select()}></textarea>` : null}
    </div>` : null}
  </div>`;
}

function MenuScreen({ G }) {
  const [seed, setSeed] = React.useState(() => String(1 + Math.floor(Math.random() * 999999999)));
  return h`<div className="screen menu">
    <h1>🏔️ Match-3 Roguelite — Ascent</h1>
    <p className="sub">One board, one climb. Clear ${CONFIG.CHECKPOINTS.length} goals — each pays moves and a power-up draft — then chase a high score until your moves run out.</p>
    <div className="menu-box">
      <label>Seed <input value=${seed} onChange=${e => setSeed(e.target.value)} inputMode="numeric" /></label>
      <${Toggle} G=${G} />
      <${ColourToggle} G=${G} />
      <button className="primary" onClick=${() => G.newRun(parseInt(seed, 10) || 1)}>Start run</button>
    </div>
    <${StatsPanel} />
    <p className="hint">Swipe or tap two adjacent tiles to swap. Match 4 → ${SPECIAL_EMOJI[CONFIG.MATCH_4_SPAWNS]} arrow, 5 → ${SPECIAL_EMOJI[CONFIG.MATCH_5_SPAWNS]} lightning, L/T → ${SPECIAL_EMOJI[CONFIG.MATCH_SHAPE_SPAWNS]} bomb.</p>
  </div>`;
}

function ColorDot({ color }) {
  return h`<span className=${'dot bg' + color}></span>`;
}

function DraftScreen({ G }) {
  const chips = buildChips(G);
  const cps = G.checkpoints();
  const next = G.run.checkpointIdx < cps.length ? cps[G.run.checkpointIdx] : null;
  return h`<div className="screen draft">
    <div className="draft-head">
      <h2>Draft ${G.run.level}</h2>
      <${Toggle} G=${G} />
      <${ColourToggle} G=${G} />
    </div>
    <p className="sub">${G.board
      ? `Score ${G.score} — ${next !== null ? `next goal at ${next}` : 'endless chase!'} · 👟 ${G.movesLeft} moves banked`
      : 'Pick a power-up — it lasts the whole run.'}</p>
    <div className="cards">
      ${G.offers.map((o, i) => {
        const def = POWERUPS[o.id];
        return h`<button className="card" key=${i} onClick=${() => G.pickOffer(i)}>
          <div className="card-icon">${def.icon}${o.color !== undefined ? h`<${ColorDot} color=${o.color} />` : null}</div>
          <div className="card-name">${def.name}${o.color !== undefined ? ` — ${COLOR_NAMES[o.color]}` : ''}</div>
          <div className="card-desc">${def.desc(o)}</div>
          <div className=${'card-tag ' + def.cluster}>${def.cluster}</div>
          ${def.tier === 3 ? h`<div className="card-tag legendary">⭐ legendary</div>` : null}
        </button>`;
      })}
    </div>
    ${chips.length ? h`<div className="build">
      <div className="build-title">Your build</div>
      <div className="chip-row">${chips.map(ch => h`<span className="chip" key=${ch.key} title=${ch.def.desc(ch.pick)}>
        ${ch.def.icon}${ch.pick.color !== undefined ? h`<${ColorDot} color=${ch.pick.color} />` : null}${ch.count > 1 ? h`<b>×${ch.count}</b>` : null}
      </span>`)}</div>
    </div>` : null}
    <div className="seedline">seed ${G.seed}</div>
  </div>`;
}

function Board({ G }) {
  const cell = useCellSize(G.cols);
  const [sel, setSel] = React.useState(null);
  const drag = React.useRef(null);

  const cellAt = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const c = Math.floor((e.clientX - rect.left) / cell);
    const r = Math.floor((e.clientY - rect.top) / cell);
    if (r < 0 || r >= G.rows || c < 0 || c >= G.cols) return null;
    return { r, c };
  };
  const onDown = e => {
    // a real pointer on the board means a human is playing — never leave
    // test fast-mode (skipped animations) on for them
    if (G.fast) { G.fast = false; G.render(); }
    const cl = cellAt(e);
    if (!cl) return;
    drag.current = { ...cl, x: e.clientX, y: e.clientY, fired: false };
  };
  const onMove = e => {
    const d = drag.current;
    if (!d || d.fired) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const mag = Math.max(Math.abs(dx), Math.abs(dy));
    if (mag > cell * 0.35) {
      d.fired = true;
      let dir;
      // with Diagonal swap, a clearly diagonal drag maps to the diagonal neighbour
      if (G.mods.diagSwap && Math.min(Math.abs(dx), Math.abs(dy)) > mag * 0.55) {
        dir = [dy > 0 ? 1 : -1, dx > 0 ? 1 : -1];
      } else {
        dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? [0, 1] : [0, -1]) : (dy > 0 ? [1, 0] : [-1, 0]);
      }
      G.trySwap({ r: d.r, c: d.c }, { r: d.r + dir[0], c: d.c + dir[1] });
      setSel(null);
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.fired) return;
    if (sel && !(sel.r === d.r && sel.c === d.c) && G.isSwappable(sel, { r: d.r, c: d.c })) { G.trySwap(sel, { r: d.r, c: d.c }); setSel(null); }
    else if (sel && sel.r === d.r && sel.c === d.c) setSel(null);
    else setSel({ r: d.r, c: d.c });
  };

  const bg = [], tiles = [], fx = [];
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const cellKey = K(r, c);
    bg.push(h`<div key=${'b' + r + '_' + c}
      className=${'bgcell' + (((r + c) % 2) ? ' alt' : '') + (G.marks.has(cellKey) ? ' mark' : '') + (G.pinatas.has(cellKey) ? ' pin' : '') + (G.triples.has(cellKey) ? ' tri' : '')}
      style=${{ transform: `translate(${c * cell}px,${r * cell}px)`, width: cell + 'px', height: cell + 'px' }}>
      ${G.marks.has(cellKey) ? '🔄' : ''}
    </div>`);
    const t = G.board[r][c];
    if (!t) continue;
    const y = (t.enter !== undefined ? t.enter : r) * cell;
    const isSel = sel && sel.r === r && sel.c === c;
    const isVol = (t.volatile || 0) > (G.moveNum || 0);
    const tileStyle = { transform: `translate(${c * cell}px,${y}px)`, width: cell + 'px', height: cell + 'px' };
    // falling tiles: duration scales with drop distance, spring easing lands with a bounce
    if (t.fallDist) tileStyle.transition = `transform ${G.fallDur(t.fallDist)}ms cubic-bezier(.22,.9,.28,1.4)`;
    tiles.push(h`<div key=${t.id} className="tile" style=${tileStyle}>
      <div className=${'tin ' + (t.chomper ? 'chomper' : t.chest ? 'chest' : 'bg' + t.color) + (t.pop ? ' pop ' + (t.popKind || 'match') : '') + (isSel ? ' sel' : '') + (t.special ? ' sp' : '') + (t.fresh ? ' fresh' : '') + (isVol ? ' vol' : '') + (t.wiggle ? ' wiggle' : '') + (t.cflash ? ' cflash' : '') + (t.chomp ? ' chomping' : '')}
        style=${t.pop && t.popDelay ? { animationDelay: t.popDelay + 'ms' } : null}>
        ${t.chomper ? h`<span className="spe">😬</span>` : null}
        ${t.chest ? h`<span className="spe">🎁</span>` : null}
        ${t.special ? h`<span className="spe">${t.special === 'arrow' ? (t.dir === 'h' ? '↔️' : '↕️') : SPECIAL_EMOJI[t.special]}</span>` : null}
        ${t.countdown !== null && t.special ? h`<span className="cd">${Math.max(0, t.countdown)}</span>` : null}
        ${(() => {
          // total value per piece: base 1 + colour boost (+ Special score when
          // this piece is a special, since specials always explode when cleared)
          const val = 1 + (G.mods.boosts[t.color] || 0) + (t.special ? G.mods.specialScore : 0);
          return val > 1 ? h`<span className=${'boostbadge' + (t.special && G.mods.specialScore ? ' gold' : '')}>${val}</span>` : null;
        })()}
      </div>
    </div>`);
  }
  const cellmarks = [];
  for (const [k, left] of G.pinatas) {
    const [r, c] = k.split(',').map(Number);
    cellmarks.push(h`<div key=${'p' + k} className="cellmark pinata"
      style=${{ left: c * cell + 'px', top: r * cell + 'px' }}>🪅<b>${left}</b></div>`);
  }
  for (const k of G.triples) {
    const [r, c] = k.split(',').map(Number);
    cellmarks.push(h`<div key=${'t' + k} className="cellmark triple"
      style=${{ left: c * cell + 'px', top: r * cell + 'px' }}>×${CONFIG.TRIPLE_TILE_MULT}</div>`);
  }
  for (const f of G.fx) {
    if (f.kind === 'part') {
      fx.push(h`<div key=${'f' + f.id} className=${'particle bg' + f.color}
        style=${{ left: (f.c + 0.5) * cell + 'px', top: (f.r + 0.5) * cell + 'px', '--dx': f.dx + 'px', '--dy': f.dy + 'px' }}></div>`);
      continue;
    }
    if (f.kind === 'wave') {
      const D = f.size * cell;
      fx.push(h`<div key=${'f' + f.id} className="wavefx"
        style=${{ left: (f.c + 0.5) * cell - D / 2 + 'px', top: (f.r + 0.5) * cell - D / 2 + 'px', width: D + 'px', height: D + 'px', animationDelay: (f.delay || 0) + 'ms' }}></div>`);
      continue;
    }
    fx.push(h`<div key=${'f' + f.id} className=${'fx ' + f.cls}
      style=${{ left: (f.c + 0.5) * cell + 'px', top: (f.r + 0.4) * cell + 'px' }}>${f.text}</div>`);
  }

  return h`<div className=${'board' + (G.shake ? ' shake' : '')}
    style=${{ width: G.cols * cell + 'px', height: G.rows * cell + 'px', '--shake-amp': (G.shake || 0) + 'px' }}
    onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerLeave=${onUp}>
    ${bg}${tiles}${cellmarks}${fx}
  </div>`;
}

function PowerBar({ G }) {
  const [info, setInfo] = React.useState(null);
  const chips = buildChips(G);
  if (!chips.length) return null;
  return h`<div className="powerbar">
    ${info !== null && chips[info] ? h`<div className="chip-info">${chips[info].def.desc(chips[info].pick)}${chips[info].def.id === 'fillup' ? ` — ${G.run.fillCount - CONFIG.FILL_UP_THRESHOLD * G.run.fillTriggers}/${CONFIG.FILL_UP_THRESHOLD}` : ''}${chips[info].def.id === 'momentum' ? ` — ${G.run.momentum || 0}/${Math.max(CONFIG.MOMENTUM_MIN, CONFIG.MOMENTUM_BASE - (chips[info].count - 1))}` : ''}</div>` : null}
    <div className="chip-row">
      ${chips.map((ch, i) => h`<button key=${ch.key}
        className=${'chip' + (ch.def.id === 'lifesaver' && G.run.lifesaverUsed ? ' used' : '') + (info === i ? ' active' : '')}
        onClick=${() => setInfo(info === i ? null : i)}>
        ${ch.def.icon}${ch.pick.color !== undefined ? h`<${ColorDot} color=${ch.pick.color} />` : null}${ch.count > 1 ? h`<b>×${ch.count}</b>` : null}
      </button>`)}
    </div>
  </div>`;
}

function FillupMeter({ G }) {
  if (!G.mods.fillup) return null;
  const charges = G.run.picks.filter(p => p.id === 'fillup').length;
  const spent = G.run.fillTriggers >= charges; // v6: battery off once every charge is used
  if (spent) return h`<div className="fillmeter" title="Fill-up: all charges spent">
    <span className="fill-icon">🔋</span>
    <div className="fill-bar"><div className="fill-fill" style=${{ width: '100%', opacity: .35 }}></div></div>
    <span className="fill-nums">spent</span>
    <span className="fill-mult">×${G.run.multiplier}</span>
  </div>`;
  const progress = G.run.fillCount - CONFIG.FILL_UP_THRESHOLD * G.run.fillTriggers;
  const pct = Math.min(100, Math.round((progress / CONFIG.FILL_UP_THRESHOLD) * 100));
  return h`<div className="fillmeter" title="Fill-up: boosted tiles matched toward the next multiplier">
    <span className="fill-icon">🔋</span>
    <div className="fill-bar"><div className="fill-fill" style=${{ width: pct + '%' }}></div></div>
    <span className="fill-nums">${progress}/${CONFIG.FILL_UP_THRESHOLD}</span>
    <span className="fill-mult">×${G.run.multiplier}</span>
  </div>`;
}

// Ported from the base branch's SnowballMeter, rewired to the v8 shared bar:
// charge from Snow crusher (specials) and/or Snow painter (boosted matches).
function SnowballMeter({ G }) {
  if (!G.run.picks.some(p => p.id === 'snowcrush' || p.id === 'snowpaint')) return null;
  const bar = CONFIG.SNOWBALL_BAR;
  const c = Math.min(G.run.snowCharge || 0, bar);
  return h`<div className="fillmeter" title="Snowball: full bar = permanent bonus points on every match you make">
    <span className="fill-icon">❄️</span>
    <div className="fill-bar"><div className="fill-fill sfill" style=${{ width: Math.round((c / bar) * 100) + '%' }}></div></div>
    <span className="fill-nums">${c}/${bar}</span>
    <span className="fill-mult">+${G.run.snowBonus || 0}</span>
  </div>`;
}

function MomentumMeter({ G }) {
  const picks = G.run.picks.filter(p => p.id === 'momentum').length;
  if (!picks) return null;
  const need = Math.max(CONFIG.MOMENTUM_MIN, CONFIG.MOMENTUM_BASE - (picks - 1));
  const cur = Math.min(G.run.momentum || 0, need);
  const pct = Math.min(100, Math.round((cur / need) * 100));
  return h`<div className="fillmeter" title="Momentum: 4+ matches you make charge a bonus move">
    <span className="fill-icon">🚀</span>
    <div className="fill-bar"><div className="fill-fill mfill" style=${{ width: pct + '%' }}></div></div>
    <span className="fill-nums">${cur}/${need}</span>
    <span className="fill-mult">+1 👟</span>
  </div>`;
}

function LevelScreen({ G }) {
  const cps = G.checkpoints();
  const idx = G.run.checkpointIdx;
  const next = idx < cps.length ? cps[idx] : null;
  // Goals UX (CD, 2026-08-31): each goal is its own bar — the fill tracks
  // progress within the CURRENT goal only and resets when it's cleared.
  const prev = idx > 0 ? cps[idx - 1] : 0;
  const pct = next !== null ? Math.max(0, Math.min(100, ((G.score - prev) / (next - prev)) * 100)) : 100;
  const cp = G.lastCheckpoint;
  return h`<div className="screen level-screen">
    <div className="hud">
      <div className=${'hud-moves-box' + (G.movesLeft <= 3 ? ' low' : '')}>
        <span className="hmb-ic">👟</span>
        <b>${G.movesLeft}</b>
        <span className="movecap">/${CONFIG.MAX_MOVES}</span>
      </div>
      <div className="hud-goal">
        <div className="goal-row">${cps.map((v, i) => h`<span key=${i} title=${v}
          className=${'goal-ic' + (i < idx ? ' done' : i === idx ? ' cur' : '')}>${i < idx ? '✓' : i + 1}</span>`)}</div>
        <div className="bar goalbar"><div className="fill" style=${{ width: pct + '%' }}></div></div>
        <div className="nums">${next !== null
          ? `${Math.max(0, G.score - prev)} / ${next - prev}`
          : h`${G.score} <span className="endless">ENDLESS 🔥</span>`}${G.run.multiplier > 1 ? h`<span className="mult"> ×${G.run.multiplier}</span>` : null}</div>
      </div>
      ${G.fast ? h`<button className="fastbadge" title="Animations off (test mode) — tap to restore"
        onClick=${() => { G.fast = false; G.render(); }}>⏩</button>` : null}
    </div>
    <${FillupMeter} G=${G} />
    <${MomentumMeter} G=${G} />
    <${SnowballMeter} G=${G} />
    <div className=${'board-wrap' + (G.phase === 'level' && G.movesLeft <= 3 && G.movesLeft >= 1 ? ' danger d' + G.movesLeft : '')}><${Board} G=${G} /></div>
    <${PowerBar} G=${G} />
    <div className="callouts">${G.callouts.map(c => h`<div key=${c.id} className=${'callout ' + (c.cls || '')}>${c.text}</div>`)}</div>
    ${G.phase === 'checkpoint' && cp ? h`<div className="overlay">
      <div className="panel">
        <h2>🚩 Goal ${cp.n} cleared!${cp.crossed > 1 ? ` (×${cp.crossed} in one move!)` : ''}</h2>
        <p>+${cp.moves} moves${cp.final ? ' — final goal cleared! The endless chase begins 🔥' : ''}</p>
        <button className="primary" onClick=${() => G.continueRun()}>Draft a power-up</button>
      </div>
    </div>` : null}
    ${G.phase === 'draft' ? h`<${InlineDraft} G=${G} />` : null}
  </div>`;
}

// Mid-run draft: an overlay OVER the board — darkened scrim, cards on top
// (CD, 2026-08-31; replaces the under-the-board inline strip).
function InlineDraft({ G }) {
  return h`<div className="overlay draft-overlay">
    <div className="draft-sheet">
      <div className="draft-inline-title">Draft ${G.run.level} — pick a power-up</div>
      <div className="cards">
        ${G.offers.map((o, i) => {
          const def = POWERUPS[o.id];
          return h`<button className="card" key=${i} onClick=${() => G.pickOffer(i)}>
            <div className="card-icon">${def.icon}${o.color !== undefined ? h`<${ColorDot} color=${o.color} />` : null}</div>
            <div className="card-name">${def.name}${o.color !== undefined ? ` — ${COLOR_NAMES[o.color]}` : ''}</div>
            <div className="card-desc">${def.desc(o)}</div>
            <div className=${'card-tag ' + def.cluster}>${def.cluster}</div>
            ${def.tier === 3 ? h`<div className="card-tag legendary">⭐ legendary</div>` : null}
          </button>`;
        })}
      </div>
    </div>
  </div>`;
}

function EndScreen({ G }) {
  const win = G.phase === 'win';
  const chips = buildChips(G);
  const [copied, setCopied] = React.useState(false);
  const [showRaw, setShowRaw] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(telemetryAll())); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch (e) { setShowRaw(true); }
  };
  return h`<div className="screen end">
    <h1>${win ? '🏆 Summit reached!' : '💀 Out of moves'}</h1>
    <div className="end-stats">
      <div><b>${G.run.checkpointIdx}</b> / ${CONFIG.CHECKPOINTS.length} goals cleared</div>
      <div><b>${G.score}</b> final score</div>
      <div className="seedline">seed ${G.seed}</div>
    </div>
    ${chips.length ? h`<div className="build">
      <div className="build-title">Final build</div>
      <div className="chip-row">${chips.map(ch => h`<span className="chip" key=${ch.key} title=${ch.def.desc(ch.pick)}>
        ${ch.def.icon}${ch.pick.color !== undefined ? h`<${ColorDot} color=${ch.pick.color} />` : null}${ch.count > 1 ? h`<b>×${ch.count}</b>` : null}
      </span>`)}</div>
    </div>` : null}
    <div className="end-buttons">
      <button className="primary" onClick=${() => G.newRun(1 + Math.floor(Math.random() * 999999999))}>New run</button>
      <button onClick=${() => G.newRun(G.seed)}>Replay this seed</button>
    </div>
    <div className="end-export">
      <button onClick=${copy}>${copied ? '✅ Copied — send it to the designer!' : '📤 Copy my play data'}</button>
      ${showRaw ? h`<textarea className="rawdata" readOnly value=${JSON.stringify(telemetryAll())}
        onFocus=${e => e.target.select()} onClick=${e => e.target.select()}></textarea>` : null}
    </div>
  </div>`;
}

function App() {
  const [, force] = React.useReducer(x => x + 1, 0);
  const ref = React.useRef(null);
  if (!ref.current) {
    ref.current = new PersistentGame(() => force());
    // Debug / test handles (used by scripted verification, harmless in play)
    const G = ref.current;
    window.RL = {
      game: G, CONFIG, POWERUPS,
      telemetry: { all: telemetryAll, summary: telemetrySummary, clear: telemetryClear },
      cheat: {
        // jump the score to the next checkpoint (base game's cheat.win analogue)
        cross() { const cps = G.checkpoints(); if (G.run.checkpointIdx < cps.length) { G.score = cps[G.run.checkpointIdx]; G.checkLevelEnd(); G.render(); } },
        win() { this.cross(); },
        addScore(n) { G.score += n; G.checkLevelEnd(); G.render(); },
        setMoves(n) { G.movesLeft = n; G.render(); },
        pick(id, color) { G.run.picks.push(color !== undefined ? { id, color } : { id }); G.computeMods(); G.render(); },
      },
    };
  }
  const G = ref.current;
  let screen;
  if (G.phase === 'menu') screen = h`<${MenuScreen} G=${G} />`;
  // Run-start draft has no board yet → full screen. Mid-run drafts render as
  // an overlay inside LevelScreen so the board stays visible (tester feedback).
  else if (G.phase === 'draft' && !G.board) screen = h`<${DraftScreen} G=${G} />`;
  else if (G.phase === 'win' || G.phase === 'loss') screen = h`<${EndScreen} G=${G} />`;
  else screen = h`<${LevelScreen} G=${G} />`;
  // Everything lives inside the phone frame; overlays/callouts anchor to it.
  return h`<div className="phone">${screen}</div>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(h`<${App} />`);
