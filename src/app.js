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
  BALANCE_VERSION: 19, // v19: interim checkpoint ease — new-art players pace ~9-11 ppm (was ~13); revert when the readability pass lands

  // Blockers: inert tiles cleared only through their own interaction (see
  // the BLOCKERS registry below CONFIG). Each type enters the REFILL pool —
  // this branch's ongoing board generation — once run.checkpointIdx reaches
  // its intro checkpoint; before that its chance is 0. Chances are per
  // refill tile; caps bound how many of a type exist at once (drip-style —
  // without them a 15% per-tile chance floods a persistent board).
  BLOCKER_STATIC_BOX_CHANCE: 0.15,
  BLOCKER_WATER_CHANCE: 0.08,
  BLOCKER_COLOR_SAFE_CHANCE: 0.05,
  BLOCKER_INTRO_CHECKPOINT_BOX: 3,
  BLOCKER_INTRO_CHECKPOINT_WATER: 5,
  BLOCKER_INTRO_CHECKPOINT_SAFE: 7,
  BLOCKER_STATIC_BOX_HITS: 3,
  BLOCKER_WATER_SPREAD_INTERVAL: 1,  // water spreads every Nth player move
  BLOCKER_COLOR_SAFE_COLORS_REQUIRED: 4, // of 5 (all of them when fewer colours are active)
  BLOCKER_CAPS: { box: 3, water: 2, safe: 1 }, // concurrent per type (water cap = seeds; spread is unbounded)
  BLOCKER_WATER_BONUS_SPECIALS: 2,   // specials awarded for clearing ALL water in one move

  // Chomper food: cell-layer snacks only Chomper can consume, paying
  // CHOMPER_FOOD_BONUS each. CHOMPER_FOOD_COUNT are ALWAYS on the board
  // while Chomper is in the build — every eaten snack is replaced at a
  // random valid interior cell the same move. Buffet adds more (stacks).
  CHOMPER_FOOD_BONUS: 20,
  CHOMPER_FOOD_COUNT: 2,           // snacks kept on the board at all times
  CHOMPER_FOOD_SPAWN_DISTANCE: 4,  // first food lands 2..this (Manhattan) from Chomper
  CHOMPER_BUFFET_TILES: 2,         // extra concurrent snacks per Buffet pick
  VARIANT: 'persistent',           // stamped into telemetry so datasets never mix

  // Hard ceiling on BANKED moves (movesLeft can never exceed this). Grants,
  // refunds, momentum, chests, fusion all clip at the cap — you can still
  // play endlessly if you keep earning, but you're never more than this many
  // moves from death. v6: 20 → 16 (Omri: still too little danger); with the
  // v6 grants (max 13) a tight crossing still fits, stacked surpluses don't.
  MAX_MOVES: 16,
  SQUARE_BONUS_MULTIPLIER: 2,      // square bonus upgrade: the 4 square tiles score ×this (all bonuses included)
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
  // v16 ease from live-v8 telemetry (124 segments): the v6 grant cuts made
  // segments 2-3 a wall (45/46% clear, median 4 moves/segment played at ≤3
  // left). Omri chose to ease CHECKPOINTS only, grants untouched: seg2 delta
  // 170→150, seg3 270→220, all later segment DELTAS preserved exactly.
  // v19 INTERIM ease: the UXI art transition cut skilled players' pace
  // (same-player, same-build: 27 → 11.4 ppm) — specials/colour scanning
  // suffer in the new art. Calibrated to observed new-art pace (~9-11 ppm);
  // seg deltas 70/130/220 up front, later deltas unchanged. Revert to
  // [80, 230, 450, 830, 1430, 2430] once the art readability pass lands.
  CHECKPOINTS: [70, 200, 420, 790, 1390, 2390],
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

/* ------------------------------ Blockers ----------------------------------
   Data-driven registry: a new blocker type = a new entry here (+ visuals),
   no engine changes. `intro` gates by checkpoints crossed; `chance` is per
   refill tile; `cap` bounds concurrency; `make` returns the tile fields.
   All blockers are protectedTile (nothing clears them but their own rule)
   and immovableTile (can't be swapped). They ride gravity like chests. */
const BLOCKERS = {
  box: {
    intro:  () => CONFIG.BLOCKER_INTRO_CHECKPOINT_BOX,
    chance: () => CONFIG.BLOCKER_STATIC_BOX_CHANCE,
    cap:    () => CONFIG.BLOCKER_CAPS.box,
    make:   () => ({ hits: CONFIG.BLOCKER_STATIC_BOX_HITS }),
  },
  water: {
    intro:  () => CONFIG.BLOCKER_INTRO_CHECKPOINT_WATER,
    chance: () => CONFIG.BLOCKER_WATER_CHANCE,
    cap:    () => CONFIG.BLOCKER_CAPS.water,
    make:   () => ({}),
  },
  safe: {
    intro:  () => CONFIG.BLOCKER_INTRO_CHECKPOINT_SAFE,
    chance: () => CONFIG.BLOCKER_COLOR_SAFE_CHANCE,
    cap:    () => CONFIG.BLOCKER_CAPS.safe,
    make:   () => ({ lit: [] }), // colour indexes matched adjacent so far
  },
};

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

// v9 chomper desc mentions his snacks (mechanics in PersistentGame below —
// movement steering stays SECRET, never hint at it).
POWERUPS.chomper.desc = () => `A hungry critter roams the board — after each move you make it eats one piece at full value (specials detonate; 🍖 snacks pay +${CONFIG.CHOMPER_FOOD_BONUS})`;

// Buffet: more snacks on the table (chomper-family upgrade, stackable).
POWERUPS.buffet = {
  id: 'buffet', name: 'Buffet', icon: '🍱', cluster: 'utility', stackable: true, tier: 2, requiresChomper: true,
  desc: () => `${CONFIG.CHOMPER_BUFFET_TILES} more 🍖 snacks stay on the board for Chomper (stacks)`,
  mods(m) { m.foodBonusTiles = (m.foodBonusTiles || 0) + CONFIG.CHOMPER_BUFFET_TILES; },
};
POWERUP_LIST.push(POWERUPS.buffet);

// v7 Spicy Trail: scorch PERSISTS until matched (shared engine gives it a
// 1-move expiry, which made triggering it nearly impossible — you'd need a
// match through one specific fresh tile on the very next move). Chomper now
// paints a burning wake; each scorched tile is a stored + blast that pays
// once (the engine zeroes `volatile` on trigger). Aftershock keeps its own
// 1-move scorch — this only touches the trail. Override is in
// PersistentGame.backfillChomperTrail below.
POWERUPS.spicytrail.desc = () => 'Tiles Chomper leaves behind stay scorched until matched — matching one sets off a small blast';

// v10 Square bonus rework: flat +10 → the 4 square-match tiles score
// ×SQUARE_BONUS_MULTIPLIER at their full per-tile value (colour boost,
// special score, and the run multiplier all included, since addBonus feeds
// the same ×multiplier pipeline). Tiles beyond the square — merged straight
// runs, cascades, explosions — score normally.
Object.assign(POWERUPS.squarescore, {
  desc: () => `The 4 tiles of a square match score ×${CONFIG.SQUARE_BONUS_MULTIPLIER} (all bonuses included)`,
  onMatch(g, p, group, api) {
    if (!group.square || group._sqPaid) return;
    group._sqPaid = true;
    // locate the 2×2(s) inside the group — it may be merged with straight runs
    const sq = new Set();
    for (const cl of group.cells) {
      const quad = [[cl.r, cl.c], [cl.r, cl.c + 1], [cl.r + 1, cl.c], [cl.r + 1, cl.c + 1]];
      if (quad.every(([r, c]) => group.cellSet.has(K(r, c)))) quad.forEach(([r, c]) => sq.add(K(r, c)));
    }
    let extra = 0;
    for (const k of sq) {
      const [r, c] = k.split(',').map(Number);
      const t = g.board[r][c];
      if (!t) continue;
      extra += 1 + (g.mods.boosts[t.color] || 0) + (t.special ? g.mods.specialScore : 0);
    }
    if (extra) api.addBonus(extra * (CONFIG.SQUARE_BONUS_MULTIPLIER - 1));
  },
});

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
    this.segPeak = 0; this.segClipped = 0; this.segDanger = 0; this.segFood = 0; // cap/food telemetry, per segment
    this.segBlockers = { box: 0, water: 0, safe: 0 };
    this.foodCells = new Set();
  }

  // 🧪 Tester tool: queued ids are injected into the next draft's first slot,
  // bypassing tier/gate rules on purpose. Drafts touched this way are marked
  // in draftHistory (forced: true) so pick-rate telemetry can exclude them.
  makeOffers() {
    const offers = super.makeOffers();
    if (this.forcedOffers && this.forcedOffers.length && offers.length) {
      const id = this.forcedOffers.shift();
      const def = POWERUPS[id];
      if (def) {
        offers[0] = { id, ...(def.roll ? def.roll(this) : {}) };
        this._forcedDraft = true;
        this.callout(`🧪 Forced offer: ${def.name}`);
      }
    }
    return offers;
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
    // Board is built BEFORE the first draft (CD, 2026-08-31): the run-start
    // draft overlays the live board exactly like every later draft. The first
    // pick then lands through the normal mid-run path in startLevel.
    this.startBoard();
    this.startDraft();
  }

  // Checkpoint values, colour-scaled (cumulative run score, not per-segment).
  checkpoints() {
    const s = CONFIG.COLOUR_TARGET_SCALE[this.opts.colours] || 1;
    return CONFIG.CHECKPOINTS.map(v => Math.round(v * s));
  }

  // Shared pickOffer calls startLevel after every pick — the variant
  // dispatcher. Every pick (the first included) mutates the LIVE board;
  // no regeneration, ever.
  async startLevel() {
    if (!this.board) this.startBoard(); // safety — newRun builds it before any draft
    const pick = this.run.picks[this.run.picks.length - 1];
    if (this._forcedDraft) { // 🧪 tester-forced draft — flag it for telemetry hygiene
      this._forcedDraft = false;
      const h = this.run.draftHistory[this.run.picks.length - 1];
      if (h) h.forced = true;
    }
    this.dripSeedFor(pick); // new drip power-ups land their first spawn instantly
    const def = POWERUPS[pick.id];
    if (def.onLevelStart) def.onLevelStart(this, pick); // spawn-once hooks (chomper family)
    if (pick.id === 'chomper') this.seedChomperFood();  // v9: his snacks arrive with him
    // One move can cross several checkpoints at once — settle every owed draft.
    this.run.pendingDrafts = Math.max(0, this.run.pendingDrafts - 1);
    if (this.run.pendingDrafts > 0) { this.startDraft(); return; }
    this.phase = 'level';
    this.busy = true;
    this.render();
    await this.growBoardAnimated(); // no-op unless Expand is owed
    if (!this.findAnyMove()) this.reshuffleBoard();
    this.checkLevelEnd(); // expansion cascades can score across a checkpoint
    this.busy = false;
    this.render();
  }

  // The run's single board generation — runs from newRun with ZERO picks
  // (first-pick hooks/drips land via startLevel's normal path); everything
  // after this mutates in place.
  startBoard() {
    this.rows = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_ROWS + this.mods.expandRows);
    this.cols = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_COLS + this.mods.expandCols);
    this.movesLeft = CONFIG.START_MOVES;
    this.segPeak = this.movesLeft; this.segClipped = 0; this.segDanger = 0; this.segFood = 0; this.segBlockers = { box: 0, water: 0, safe: 0 };
    this.lastWarnedMoves = null;
    this.score = 0;
    this.segStartScore = 0;  // telemetry: score at the current segment's start
    this.movesUsed = 0; this.moveScores = []; // per segment, reset on each log
    this.moveNum = 0;        // 1-based during a move; drives Snowball and Aftershock expiry
    this.tempoUsed = false;  // Tempo's ×N is armed until the first match after each checkpoint
    this.genBoard();
    this.marks = new Set();
    this.pinatas = new Map(); this.triples = new Set(); this.tripleArmed = false;
    this.foodCells = new Set(); // cell layer, like marks — foodTarget() kept stocked
    this.drip = { pinata: 0, chest: 0, triple: 0 };
    this.pendingChests = 0;
    this.lastSwapDir = null;
    this.emit('onLevelStart'); // no-op with no picks (spawn-once hooks live on picks)
    if (!this.findAnyMove()) this.reshuffleBoard(); // placed pieces can rarely kill the only move
    this.phase = 'level';
    this.busy = false;
    this.render();
  }

  // v9 Expand payoff moment: rows append at the BOTTOM, columns at the RIGHT
  // (cell keys for marks/piñatas/triples stay valid) — but the new cells stay
  // EMPTY, so gravity visibly pulls the existing pieces outward into the gap
  // and fresh tiles rain in from above. Natural fill means the growth can
  // land matches and cascade — the board growing IS the reward.
  async growBoardAnimated() {
    const wantRows = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_ROWS + this.mods.expandRows);
    const wantCols = Math.min(CONFIG.MAX_BOARD, CONFIG.BOARD_COLS + this.mods.expandCols);
    if (this.rows >= wantRows && this.cols >= wantCols) return;
    while (this.rows < wantRows) { this.board.push(Array(this.cols).fill(null)); this.rows++; }
    while (this.cols < wantCols) { this.cols++; for (let r = 0; r < this.rows; r++) this.board[r].push(null); }
    this.callout('📏 The board grows!');
    this.doShake(8);
    this.render(); await this.sleep(380); // let the bigger frame and the gap read
    await this.dropAndFill();             // pieces shift outward, new tiles fall in
    await this.resolveBoard(null);        // growth cascades are allowed — payoff
  }

  /* --------------------------- Chomper food ------------------------------
     Food lives on the CELL layer, exactly like xtra-move marks: it sits
     BEHIND pieces (foodCells: key -> respawns left), pieces on it match and
     clear normally, and it never moves. Unlike marks/piñatas/triples, food
     cells are NOT walls — Chomper walks onto them and eats the snack
     (+CHOMPER_FOOD_BONUS). foodTarget() snacks are ALWAYS on the board while
     Chomper is in the build: every eaten one is replaced the same move. */
  foodTarget() {
    return this.mods.chomper ? CONFIG.CHOMPER_FOOD_COUNT + (this.mods.foodBonusTiles || 0) : 0;
  }

  topUpFood() {
    let guard = 0;
    while (this.foodCells.size < this.foodTarget() && guard++ < 20) {
      if (!this.spawnFoodRandom()) break;
    }
  }

  foodCellOk(r, c) {
    if (r <= 0 || r >= this.rows - 1 || c <= 0 || c >= this.cols - 1) return false; // interior only
    const k = K(r, c);
    if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k) || this.foodCells.has(k)) return false;
    const t = this.board[r][c];
    return !!t && !t.special && !this.protectedTile(t); // not on specials or indestructibles (chest/Chomper block his step)
  }

  spawnFoodAt(r, c) {
    this.foodCells.add(K(r, c));
    this.addFx(r, c, '🍖', 'emoji');
  }

  spawnFoodRandom() {
    let guard = 0;
    while (guard++ < 300) {
      const r = 1 + Math.floor(this.rng() * (this.rows - 2)), c = 1 + Math.floor(this.rng() * (this.cols - 2));
      if (!this.foodCellOk(r, c)) continue;
      this.spawnFoodAt(r, c);
      return true;
    }
    return false;
  }

  seedChomperFood() {
    // first snack lands close to him (2..CHOMPER_FOOD_SPAWN_DISTANCE away,
    // never adjacent) so the secret movement rule has something to reveal
    let ch = null;
    for (let r = 0; r < this.rows && !ch; r++) for (let c = 0; c < this.cols; c++)
      if (this.board[r][c] && this.board[r][c].chomper) { ch = { r, c }; break; }
    let placed = 0;
    if (ch) {
      const near = [];
      for (let r = 1; r < this.rows - 1; r++) for (let c = 1; c < this.cols - 1; c++) {
        const d = Math.abs(r - ch.r) + Math.abs(c - ch.c);
        if (d >= 2 && d <= CONFIG.CHOMPER_FOOD_SPAWN_DISTANCE && this.foodCellOk(r, c)) near.push({ r, c });
      }
      if (near.length) {
        const p = near[Math.floor(this.rng() * near.length)];
        this.spawnFoodAt(p.r, p.c);
        placed++;
      }
    }
    this.topUpFood(); // fill the rest of the table
  }

  // v10 Chomper timing: he resolves FIRST — his step happens right after
  // the swap lands, before matches clear or gravity runs, so aiming him at
  // a snack can't be spoiled by the board churning under him. His own
  // trailing board-settle is suppressed here; the outer resolveBoard then
  // resolves everything WITH swapCells, keeping the player's match ACTIVE
  // (sweep/snowball/momentum/mark-refund semantics intact).
  async resolveBoard(swapCells) {
    if (this._suppressResolve) return; // chomper's internal settle — the outer call covers it
    if (swapCells && this.mods.chomper && this.phase === 'level') {
      this._suppressResolve = true;
      try { await this.chomperStepAndEat(); } finally { this._suppressResolve = false; }
      this._chomperStepped = true; // endOfMove must not step him twice
    }
    await super.resolveBoard(swapCells);
  }

  // Shared endOfMove hook — skip when he already pre-stepped this move
  // (merge moves and board effects still reach here and step him normally).
  async chomperMove() {
    if (this._chomperStepped) { this._chomperStepped = false; return; }
    await this.chomperStepAndEat();
  }

  // Eat on arrival: after his step, any Chomper standing on a food cell
  // consumes it (cell marks never move, so position is the identity); the
  // table is restocked the same move — CHOMPER_FOOD_COUNT (+Buffet) always.
  async chomperStepAndEat() {
    await super.chomperMove();
    if (!this.foodCells.size) return;
    let ate = false;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const t = this.board[r][c];
      if (!t || !t.chomper) continue;
      const k = K(r, c);
      if (!this.foodCells.has(k)) continue;
      this.foodCells.delete(k);
      this.score += CONFIG.CHOMPER_FOOD_BONUS;
      this.segFood = (this.segFood || 0) + 1;
      this.addFx(r, c, `🍖 +${CONFIG.CHOMPER_FOOD_BONUS}`, 'big');
      this.callout('😬 nom!');
      ate = true;
    }
    if (ate) { this.topUpFood(); this.render(); }
  }

  continueRun() {
    if (this.phase !== 'checkpoint') return;
    this.startDraft();
  }

  // Engine trySwap calls this once per resolved player move — drip spawns
  // ride the move tail so cheats/board effects never advance the economy.
  async endOfMove() {
    const hadWater = this.waterCount() > 0;
    this.waterClearedThisMove = false;
    await super.endOfMove();
    if (this.phase === 'level') {
      // all the move's water removals are done — bonus if the board is dry now
      if (hadWater && this.waterClearedThisMove && this.waterCount() === 0) this.waterAllClearBonus();
      // spread AFTER the move and its cascades fully resolve
      if (this.moveNum % Math.max(1, CONFIG.BLOCKER_WATER_SPREAD_INTERVAL) === 0) this.waterSpread();
      this.dripRolls();
      this.topUpFood(); // the table never runs low (no-op without Chomper)
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
      foodEaten: this.segFood || 0,  // v9: chomper snacks eaten this segment
      blockers: { ...this.segBlockers }, // v10: boxes broken / water removed / safes opened
      fast: !!this.fast, // bot/test runs — excluded from human summaries
    });
    this.segStartScore = this.score;
    this.movesUsed = 0; this.moveScores = [];
    this.segPeak = this.movesLeft; this.segClipped = 0; this.segDanger = 0; this.segFood = 0; this.segBlockers = { box: 0, water: 0, safe: 0 };
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

  // Queued drip chests ride in as the topmost refill tile of a column;
  // unlocked blockers roll for each remaining refill slot (v10).
  makeRefillTile(r, c) {
    if (r === 0 && this.pendingChests > 0) {
      this.pendingChests--;
      return { id: this.tileId++, color: -1, chest: true, special: null, dir: null, countdown: null };
    }
    const b = this.rollBlockerTile();
    if (b) return b;
    return super.makeRefillTile(r, c);
  }

  /* ------------------------------ Blockers -------------------------------
     Inert tiles cleared only via their own interaction. Protected from all
     clears/transforms, unswappable, walls for Chomper; they ride gravity. */
  protectedTile(t) { return super.protectedTile(t) || !!(t && t.blocker); }
  immovableTile(t) { return super.immovableTile(t) || !!(t && t.blocker); }
  gravityFixed(t) { return !!(t && t.blocker); } // blockers hang in place; holes persist beneath them

  blockerCount(type) {
    let n = 0;
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++)
      if (this.board[r][c] && this.board[r][c].blocker === type) n++;
    return n;
  }

  rollBlockerTile() {
    for (const [type, def] of Object.entries(BLOCKERS)) {
      if (this.run.checkpointIdx < def.intro()) continue; // chance is 0 before the intro checkpoint
      if (this.blockerCount(type) >= def.cap()) continue;
      if (this.rng() < def.chance())
        return { id: this.tileId++, color: -4, blocker: type, ...def.make(),
                 special: null, dir: null, countdown: null, fresh: true };
    }
    return null;
  }

  // Match-time blocker effects, same timing as other match effects: the
  // shared processStep stamps group.active, then this runs. Boxes and safes
  // count PLAYER matches only; water is removed by any match (cascades too),
  // and removing a water chain-removes the connected puddle.
  processStep(groups, swapCells, seeds, boardClears = []) {
    const res = super.processStep(groups, swapCells, seeds, boardClears);
    if (groups.length) this.blockerMatchEffects(groups);
    this.blockerExplosionEffects(res);
    return res;
  }

  // Special-piece explosions AFFECT blockers (they still aren't cleared by
  // them): a blast covering a box deals 1 hit, water in the blast is removed
  // (chain rule applies), and a safe lights the exploding special's colour.
  // Runs before applyStep, so exploding specials are still on the board.
  blockerExplosionEffects(res) {
    const hit = new Set(); // one effect per blocker per step
    for (const { r, c, explosion } of res.cleared.values()) {
      const t = this.board[r][c];
      if (!t || !t.special) continue; // every cleared special explodes (invariant)
      for (const cl of this.explosionCells(r, c, t)) {
        const b = this.board[cl.r][cl.c];
        if (!b || !b.blocker || hit.has(b.id)) continue;
        hit.add(b.id);
        if (b.blocker === 'water') this.removeWaterChain(cl.r, cl.c);
        else if (b.blocker === 'box') this.damageBox(cl.r, cl.c, b);
        else if (b.blocker === 'safe') this.lightSafe(cl.r, cl.c, b, t.color);
      }
    }
  }

  blockerNeighbors(group) {
    const seen = new Set(), out = [];
    for (const cl of group.cells) for (const [dr, dc] of DIRS4) {
      const r = cl.r + dr, c = cl.c + dc, k = K(r, c);
      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols || seen.has(k)) continue;
      seen.add(k);
      const t = this.board[r][c];
      if (t && t.blocker) out.push({ r, c, t });
    }
    return out;
  }

  blockerMatchEffects(groups) {
    for (const g of groups) {
      const hitOnce = new Set(); // one box hit / safe light per group
      for (const { r, c, t } of this.blockerNeighbors(g)) {
        if (t.blocker === 'water') { // any match frees water, cascades included
          this.removeWaterChain(r, c);
          continue;
        }
        if (!g.active || hitOnce.has(t.id)) continue; // boxes/safes: player matches only
        hitOnce.add(t.id);
        if (t.blocker === 'box') this.damageBox(r, c, t);
        else if (t.blocker === 'safe') this.lightSafe(r, c, t, g.color);
      }
    }
  }

  // Chomper can't pass through blockers — but the ATTEMPT counts as a hit:
  // a bumped box takes 1 damage, bumped water is removed (chain rule), and a
  // bumped safe lights one random UNLIT colour. Chests and other chompers
  // still block silently, as before.
  onChomperBlocked(r, c, t) {
    if (!t.blocker) return;
    this.doShake(3);
    if (t.blocker === 'water') this.removeWaterChain(r, c);
    else if (t.blocker === 'box') this.damageBox(r, c, t);
    else if (t.blocker === 'safe') {
      const unlit = [];
      for (let i = 0; i < this.opts.colours; i++) if (!t.lit.includes(i)) unlit.push(i);
      if (unlit.length) this.lightSafe(r, c, t, unlit[Math.floor(this.rng() * unlit.length)]);
    }
  }

  damageBox(r, c, t) {
    t.hits--;
    this.addFx(r, c, t.hits > 0 ? '📦' : '💥', 'emoji');
    this.doShake(4);
    if (t.hits <= 0) { // breaks open: a bomb sits where the box was
      this.board[r][c] = { id: this.tileId++, color: Math.floor(this.rng() * this.opts.colours),
                           special: 'bomb', dir: null,
                           countdown: this.mods.countdown ? CONFIG.COUNTDOWN_TIMER_START : null, fresh: true };
      this.segBlockers.box++;
      this.callout('📦 Box cracked — bomb inside!');
    }
  }

  lightSafe(r, c, t, color) {
    if (color === undefined || color === null || color < 0 || t.lit.includes(color)) return;
    t.lit.push(color);
    this.addFx(r, c, '🔓', 'emoji');
    const need = Math.min(CONFIG.BLOCKER_COLOR_SAFE_COLORS_REQUIRED, this.opts.colours);
    if (t.lit.length >= need) { // opens: a lightning sits where the safe was
      this.board[r][c] = { id: this.tileId++, color: Math.floor(this.rng() * this.opts.colours),
                           special: 'lightning', dir: null,
                           countdown: this.mods.countdown ? CONFIG.COUNTDOWN_TIMER_START : null, fresh: true };
      this.segBlockers.safe++;
      this.callout('🔓 Safe opened — lightning inside!');
      this.doShake(8);
      this.addWave(r, c, 4, 0);
    }
  }

  // Water removal chain-clears the orthogonally connected puddle. 0 points.
  // Emptying the board of water in one move pays 2 random special pieces.
  removeWaterChain(r, c) {
    const stack = [[r, c]];
    while (stack.length) {
      const [rr, cc] = stack.pop();
      const t = this.board[rr] && this.board[rr][cc];
      if (!t || t.blocker !== 'water') continue;
      this.board[rr][cc] = this.makeTile(this.rollRefillColor());
      this.board[rr][cc].fresh = true;
      this.segBlockers.water++;
      this.addFx(rr, cc, '💧', 'emoji');
      for (const [dr, dc] of DIRS4) stack.push([rr + dr, cc + dc]);
    }
    this.waterClearedThisMove = true;
  }

  waterCount() { return this.blockerCount('water'); }

  // Spread: after the move fully resolves (cascades included) each water
  // tile claims one random valid orthogonal neighbour — never specials,
  // chests, Chomper, other blockers, or cells carrying food/marks/piñatas/
  // triples. A puddle with nowhere to go sits still that move.
  waterSpread() {
    const waters = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++)
      if (this.board[r][c] && this.board[r][c].blocker === 'water') waters.push({ r, c });
    let spread = false;
    for (const w of waters) {
      const cands = [];
      for (const [dr, dc] of DIRS4) {
        const r = w.r + dr, c = w.c + dc, k = K(r, c);
        if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
        if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k) || this.foodCells.has(k)) continue;
        const t = this.board[r][c];
        if (!t || t.special || this.protectedTile(t)) continue; // normal coloured tiles only
        cands.push({ r, c });
      }
      if (!cands.length) continue;
      const p = cands[Math.floor(this.rng() * cands.length)];
      const nw = { id: this.tileId++, color: -4, blocker: 'water', special: null, dir: null, countdown: null, fresh: true, ripple: true };
      this.board[p.r][p.c] = nw;
      setTimeout(() => { delete nw.ripple; this.render(); }, 700);
      spread = true;
    }
    if (spread) { this.render(); this.doShake(3); }
  }

  // All-clear bonus: 2 random special pieces on random interior normal tiles.
  waterAllClearBonus() {
    this.callout('🌊 Water cleared — bonus specials!');
    let placed = 0, guard = 0;
    while (placed < CONFIG.BLOCKER_WATER_BONUS_SPECIALS && guard++ < 300) {
      const r = 1 + Math.floor(this.rng() * (this.rows - 2)), c = 1 + Math.floor(this.rng() * (this.cols - 2));
      const t = this.board[r][c];
      if (!t || t.special || this.protectedTile(t)) continue;
      const type = ['bomb', 'arrow', 'lightning'][Math.floor(this.rng() * 3)];
      this.board[r][c] = { id: this.tileId++, color: t.color, special: type,
                           dir: type === 'arrow' ? (this.rng() < 0.5 ? 'h' : 'v') : null,
                           countdown: this.mods.countdown ? CONFIG.COUNTDOWN_TIMER_START : null, fresh: true };
      this.addFx(r, c, '✨', 'emoji');
      placed++;
    }
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
    else if (pick.id === 'buffet') this.topUpFood(); // extra snacks land instantly
  }

  spawnMark() {
    let guard = 0;
    while (guard++ < 300) {
      const r = Math.floor(this.rng() * this.rows), c = Math.floor(this.rng() * this.cols);
      // edges are fine for xtra-move marks, corners are not (too few matches reach them)
      if ((r === 0 || r === this.rows - 1) && (c === 0 || c === this.cols - 1)) continue;
      const k = K(r, c);
      if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k)) continue;
      if (this.foodCells.has(k)) continue; // marked cells would wall Chomper off his snacks
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

// Slot art helper: an <img> for the slot when the manifest has it, else null
// (caller renders its emoji/CSS fallback). See ASSET_MANIFEST.md.
function slotImg(id, cls) {
  return SKIN.has(id) ? h`<img className=${cls || 'skin-img'} src=${SKIN.url(id)} alt="" />` : null;
}
// Power-up icon: slot art (em-sized, flows like a glyph) or the roster emoji.
function puIcon(id) {
  return slotImg('icon.powerup.' + id, 'pu-img') || POWERUPS[id].icon;
}

function useCellSize(cols, rows) {
  // Fit the board inside the phone frame in BOTH axes: width minus screen
  // padding (24) + board.frame border/padding (52); height minus HUD, meters,
  // power bar and gaps (~340). Recomputed on expand picks, not just resize.
  const calc = () => {
    const availW = Math.min(window.innerWidth, 430) - 76;
    const availH = Math.min(window.innerHeight, 932) - 340;
    return Math.max(24, Math.min(56, Math.floor(availW / cols), Math.floor(availH / rows)));
  };
  const [s, setS] = React.useState(calc);
  React.useEffect(() => {
    setS(calc()); // expand picks change cols/rows without a window resize
    const f = () => setS(calc());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, [cols, rows]);
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

// Player-facing menu is just logo + CTA; seed/toggles/stats live in a
// collapsed DEV drawer (CD, 2026-08-31 — match-quest dev-drawer pattern).
function MenuScreen({ G }) {
  const [seed, setSeed] = React.useState(() => String(1 + Math.floor(Math.random() * 999999999)));
  const [dev, setDev] = React.useState(false);
  return h`<div className="screen menu">
    ${SKIN.has('logo')
      ? h`<img className="menu-logo" src=${SKIN.url('logo')} alt="Match-3 Roguelite — Ascent" />`
      : h`<h1>🏔️ Match-3 Roguelite — Ascent</h1>`}
    <p className="sub">One board, one climb. Clear ${CONFIG.CHECKPOINTS.length} goals — each pays moves and a spell draft — then chase a high score until your moves run out.</p>
    <button className="primary menu-start" onClick=${() => G.newRun(parseInt(seed, 10) || 1)}>Play level</button>
    <button className="devtoggle" onClick=${() => setDev(!dev)}>🛠 dev ${dev ? '▲' : '▼'}</button>
    ${dev ? h`<div className="dev-drawer">
      <label className="dev-seed">Seed <input value=${seed} onChange=${e => setSeed(e.target.value)} inputMode="numeric" /></label>
      <${Toggle} G=${G} />
      <${ColourToggle} G=${G} />
      <${StatsPanel} />
    </div>` : null}
    <div className="end-art menu-art">${SKIN.has('menu.art')
      ? h`<img className="skin-img" src=${SKIN.url('menu.art')} alt="" />`
      : h`<span className="end-art-label">menu.art</span>`}</div>
  </div>`;
}

function ColorDot({ color }) {
  return h`<span className=${'dot bg' + color}></span>`;
}

// Shared draft card (CD, 2026-08-31): big icon on the LEFT, name (title font)
// + description to the right, cluster tag as a ribbon off the right edge.
function DraftCard({ G, o, i }) {
  const def = POWERUPS[o.id];
  return h`<button className="card" onClick=${() => G.pickOffer(i)}>
    <div className="card-icon">${puIcon(o.id)}${o.color !== undefined ? h`<${ColorDot} color=${o.color} />` : null}</div>
    <div className="card-main">
      <div className="card-name">${def.name}${o.color !== undefined ? ` — ${COLOR_NAMES[o.color]}` : ''}</div>
      <div className="card-desc">${def.desc(o)}</div>
    </div>
    <div className=${'card-tag ' + def.cluster}>${def.cluster}</div>
    ${def.tier === 3 ? h`<div className="card-tag legendary">⭐ legendary</div>` : null}
  </button>`;
}

function Board({ G }) {
  const cell = useCellSize(G.cols, G.rows);
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
    const cellSlot = ((r + c) % 2) ? 'board.cell-alt' : 'board.cell';
    // cell backs sit ~10% LOW: the stacked piece art overhangs downward, so
    // the back aligns with the piece's body, not its upper face (CD)
    const cellDrop = Math.round(cell * 0.10);
    bg.push(h`<div key=${'b' + r + '_' + c}
      className=${'bgcell' + (((r + c) % 2) ? ' alt' : '') + (SKIN.has(cellSlot) ? ' img' : '') + (G.marks.has(cellKey) ? ' mark' : '') + (G.pinatas.has(cellKey) ? ' pin' : '') + (G.triples.has(cellKey) ? ' tri' : '') + (G.foodCells.has(cellKey) ? ' foodc' : '')}
      style=${{ transform: `translate(${c * cell}px,${r * cell + cellDrop}px)`, width: cell + 'px', height: cell + 'px',
                ...(SKIN.has(cellSlot) ? { backgroundImage: `url(${SKIN.url(cellSlot)})`, backgroundSize: '100% 100%' } : null) }}>
    </div>`);
    const t = G.board[r][c];
    if (!t) continue;
    const y = (t.enter !== undefined ? t.enter : r) * cell;
    const isSel = sel && sel.r === r && sel.c === c;
    const isVol = (t.volatile || 0) > (G.moveNum || 0);
    const tileStyle = { transform: `translate(${c * cell}px,${y}px)`, width: cell + 'px', height: cell + 'px' };
    // falling tiles: duration scales with drop distance, spring easing lands with a bounce
    if (t.fallDist) tileStyle.transition = `transform ${G.fallDur(t.fallDist)}ms cubic-bezier(.22,.9,.28,1.4)`;
    // slot art per tile kind (CD, 2026-08-31): the coloured piece art is the
    // BASE even for specials — the special asset is a transparent glyph
    // painted over it. Art renders as-is; missing slots keep emoji/CSS.
    const specialSlot = t.special
      ? (t.special === 'arrow' ? 'special.arrow-' + (t.dir === 'h' ? 'h' : 'v') : 'special.' + t.special)
      : null;
    // boosted colours swap to their lit-up sprite variant (CD, 2026-08-31)
    const pieceSlot = 'piece.' + SKIN.PIECE_SLOTS[t.color];
    const art = t.chomper ? slotImg('tile.chomper', 'piece-img')
      : t.chest ? slotImg('tile.chest', 'piece-img')
      : t.blocker ? slotImg('tile.blocker.' + t.blocker, 'piece-img') // v10 art slots; CSS+emoji fallback below
      : ((G.mods.boosts[t.color] || 0) > 0 && slotImg(pieceSlot + '.boosted', 'piece-img'))
        || slotImg(pieceSlot, 'piece-img');
    const spArt = t.special ? slotImg(specialSlot, 'sp-img') : null;
    // stacked volume: the art's bottom lip tucks BEHIND the row below —
    // LOWER rows draw over upper ones (z rises with row; CD fix 2026-08-31)
    tileStyle.zIndex = r + 1 + (isSel ? 11 : 0); /* stays under fx/callouts */
    tiles.push(h`<div key=${t.id} className="tile" style=${tileStyle}>
      <div className=${'tin ' + (t.chomper ? 'chomper' : t.chest ? 'chest' : t.blocker ? 'blocker ' + t.blocker + (t.blocker === 'box' ? ' hits' + Math.max(1, t.hits) : '') + (t.ripple ? ' ripple' : '') : 'bg' + t.color) + (art ? ' skinned' : '') + (t.pop ? ' pop ' + (t.popKind || 'match') : '') + (isSel ? ' sel' : '') + (t.special ? ' sp' : '') + (t.fresh ? ' fresh' : '') + (isVol ? ' vol' : '') + (t.wiggle ? ' wiggle' : '') + (t.cflash ? ' cflash' : '') + (t.chomp ? ' chomping' : '')}
        style=${t.pop && t.popDelay ? { animationDelay: t.popDelay + 'ms' } : null}>
        ${art}
        ${spArt}
        ${!art && t.chomper ? h`<span className="spe">😬</span>` : null}
        ${!art && t.blocker === 'box' ? h`<span className="spe">📦</span>` : null}
        ${!art && t.blocker === 'water' ? h`<span className="spe">💧</span>` : null}
        ${!art && t.blocker === 'safe' ? h`<span className="spe">🔒</span>` : null}
        ${t.blocker === 'box' ? h`<span className="cd">${Math.max(0, t.hits)}</span>` : null}
        ${t.blocker === 'safe' ? h`<span className="safeslots">${Array.from({ length: G.opts.colours }, (_, i) =>
          h`<span key=${i} className=${'safeslot bgdot' + i + (t.lit.includes(i) ? ' lit' : '')}></span>`)}</span>` : null}
        ${!art && t.chest ? h`<span className="spe">🎁</span>` : null}
        ${!spArt && t.special ? h`<span className="spe">${t.special === 'arrow' ? (t.dir === 'h' ? '↔️' : '↕️') : SPECIAL_EMOJI[t.special]}</span>` : null}
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
  // xtra-move marks ride ABOVE the tiles (opaque stacked art hides the cell)
  for (const k of G.marks) {
    const [r, c] = k.split(',').map(Number);
    cellmarks.push(h`<div key=${'m' + k} className="cellmark xmark"
      style=${{ left: c * cell + 'px', top: r * cell + 'px' }}>${slotImg('marker.xtramove', 'mark-img') || '🔄'}</div>`);
  }
  for (const [k, left] of G.pinatas) {
    const [r, c] = k.split(',').map(Number);
    cellmarks.push(h`<div key=${'p' + k} className="cellmark pinata"
      style=${{ left: c * cell + 'px', top: r * cell + 'px' }}>${slotImg('marker.pinata', 'mark-img') || '🪅'}<b>${left}</b></div>`);
  }
  for (const k of G.triples) {
    const [r, c] = k.split(',').map(Number);
    cellmarks.push(h`<div key=${'t' + k} className="cellmark triple"
      style=${{ left: c * cell + 'px', top: r * cell + 'px' }}>${slotImg('marker.triple', 'mark-img')}×${CONFIG.TRIPLE_TILE_MULT}</div>`);
  }
  for (const k of G.foodCells) {
    const [r, c] = k.split(',').map(Number);
    cellmarks.push(h`<div key=${'fd' + k} className="cellmark food"
      style=${{ left: c * cell + 'px', top: r * cell + 'px' }}>${slotImg('marker.food', 'mark-img') || '🍖'}</div>`);
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

  // board height includes the last row's lip overhang (17% of a cell), so the
  // frame's top and bottom gaps around the visible tiles come out equal (CD)
  return h`<div className=${'board' + (G.shake ? ' shake' : '')}
    style=${{ width: G.cols * cell + 'px', height: G.rows * cell + Math.round(cell * 0.17) + 'px', '--shake-amp': (G.shake || 0) + 'px' }}
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
        ${puIcon(ch.def.id)}${ch.pick.color !== undefined ? h`<${ColorDot} color=${ch.pick.color} />` : null}${ch.count > 1 ? h`<b>×${ch.count}</b>` : null}
      </button>`)}
    </div>
  </div>`;
}

function FillupMeter({ G }) {
  if (!G.mods.fillup) return null;
  const charges = G.run.picks.filter(p => p.id === 'fillup').length;
  const spent = G.run.fillTriggers >= charges; // v6: battery off once every charge is used
  if (spent) return h`<div className="fillmeter" title="Fill-up: all charges spent">
    <span className="fill-icon">${slotImg('icon.fillup', 'pu-img') || '🔋'}</span>
    <div className="fill-bar"><div className="fill-fill" style=${{ width: '100%', opacity: .35 }}></div></div>
    <span className="fill-nums">spent</span>
    <span className="fill-mult">×${G.run.multiplier}</span>
  </div>`;
  const progress = G.run.fillCount - CONFIG.FILL_UP_THRESHOLD * G.run.fillTriggers;
  const pct = Math.min(100, Math.round((progress / CONFIG.FILL_UP_THRESHOLD) * 100));
  return h`<div className="fillmeter" title="Fill-up: boosted tiles matched toward the next multiplier">
    <span className="fill-icon">${slotImg('icon.fillup', 'pu-img') || '🔋'}</span>
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
    <span className="fill-icon">${slotImg('icon.snowball', 'pu-img') || '❄️'}</span>
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
    <span className="fill-icon">${slotImg('icon.momentum', 'pu-img') || '🚀'}</span>
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
    <div className="board-stack">
      <div className="hud">
        <div className=${'hud-moves-box' + (G.movesLeft <= 3 ? ' low' : '')}>
          <span className="hmb-label">Moves</span>
          <b className="hmb-num">${G.movesLeft}</b>
          <span className="movecap">MAX ${CONFIG.MAX_MOVES}</span>
        </div>
        <div className="hud-goal">
          <div className="goal-row">${cps.map((v, i) => h`<span key=${i} title=${v}
            className=${'goal-ic' + (i < idx ? ' done' : i === idx ? ' cur' : '')}>${i < idx ? '✓' : i + 1}</span>`)}</div>
          <div className="bar goalbar">
            <div className="fill" style=${{ width: pct + '%' }}></div>
            <div className="bar-label">${next !== null
              ? `${Math.max(0, G.score - prev)} / ${next - prev}`
              : h`${G.score} <span className="endless">ENDLESS 🔥</span>`}${G.run.multiplier > 1 ? h`<span className="mult"> ×${G.run.multiplier}</span>` : null}</div>
          </div>
        </div>
        ${G.fast ? h`<button className="fastbadge" title="Animations off (test mode) — tap to restore"
          onClick=${() => { G.fast = false; G.render(); }}>⏩</button>` : null}
      </div>
      <div className=${'board-wrap' + (G.phase === 'level' && G.movesLeft <= 3 && G.movesLeft >= 1 ? ' danger d' + G.movesLeft : '')}
        style=${SKIN.has('board.frame') ? { borderImage: `url(${SKIN.url('board.frame')}) 96 fill / 20px stretch`, borderWidth: '20px', borderStyle: 'solid', borderColor: 'transparent', background: 'none', boxShadow: 'none', padding: '6px' } : null}><${Board} G=${G} /></div>
      <div className="meters">
        <${FillupMeter} G=${G} />
        <${MomentumMeter} G=${G} />
        <${SnowballMeter} G=${G} />
      </div>
    </div>
    <${PowerBar} G=${G} />
    <div className="callouts">${G.callouts.map(c => h`<div key=${c.id} className=${'callout ' + (c.cls || '')}>${c.text}</div>`)}</div>
    ${G.phase === 'checkpoint' && cp ? h`<div className="overlay">
      <div className="panel goal-panel">
        <h2>🚩 Goal ${cp.n} cleared!${cp.crossed > 1 ? ` (×${cp.crossed} in one move!)` : ''}</h2>
        <p>+${cp.moves} moves${cp.final ? ' — final goal cleared! The endless chase begins 🔥' : ''}</p>
        <button className="primary" onClick=${() => G.continueRun()}>Draft a power-up</button>
      </div>
    </div>` : null}
    ${G.phase === 'draft' ? h`<${InlineDraft} G=${G} />` : null}
  </div>`;
}

// Every draft (run-start included) is an overlay OVER the board — darkened
// scrim, cards on top (CD, 2026-08-31). Subtitle names the goal just reached.
function InlineDraft({ G }) {
  return h`<div className="overlay draft-overlay">
    <div className="draft-sheet">
      <div className="draft-sub">${G.run.checkpointIdx > 0 ? `Goal ${G.run.checkpointIdx}` : 'The run begins'}</div>
      <div className="draft-title">Pick a Spell</div>
      <div className="cards">
        ${G.offers.map((o, i) => h`<${DraftCard} key=${i} G=${G} o=${o} i=${i} />`)}
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
    <div className="end-sub">${win ? '🏆 Summit reached — endless chase complete!' : '💀 Out of moves'}</div>
    <h1>Cleared ${G.run.checkpointIdx} ${G.run.checkpointIdx === 1 ? 'goal' : 'goals'}!</h1>
    <div className="end-stats">
      <div><b>${G.score}</b> final score</div>
      <div className="seedline">seed ${G.seed}</div>
    </div>
    ${chips.length ? h`<div className="build">
      <div className="build-title">Final build</div>
      <div className="chip-row">${chips.map(ch => h`<span className="chip" key=${ch.key} title=${ch.def.desc(ch.pick)}>
        ${puIcon(ch.def.id)}${ch.pick.color !== undefined ? h`<${ColorDot} color=${ch.pick.color} />` : null}${ch.count > 1 ? h`<b>×${ch.count}</b>` : null}
      </span>`)}</div>
    </div>` : null}
    <div className="end-buttons">
      <button className="primary" onClick=${() => G.newRun(1 + Math.floor(Math.random() * 999999999))}>Play again</button>
      <div className="end-secondary">
        <button onClick=${() => G.newRun(G.seed)}>Replay this seed</button>
        <button onClick=${copy}>${copied ? '✅ Copied' : '📤 Copy my play data'}</button>
      </div>
      ${showRaw ? h`<textarea className="rawdata" readOnly value=${JSON.stringify(telemetryAll())}
        onFocus=${e => e.target.select()} onClick=${e => e.target.select()}></textarea>` : null}
    </div>
    <div className="end-art">${SKIN.has('end.art')
      ? h`<img className="skin-img" src=${SKIN.url('end.art')} alt="" />`
      : h`<span className="end-art-label">end.art</span>`}</div>
  </div>`;
}

// 🧪 Tester panel: force any power-up into the draft. Floating button, all
// screens; queued picks land in the NEXT draft's first slot (or reroll the
// current draft on the spot). Forced drafts are flagged in telemetry.
function TesterPanel({ G }) {
  const [open, setOpen] = React.useState(false);
  const [sel, setSel] = React.useState('chomper');
  const [, bump] = React.useReducer(x => x + 1, 0);
  const queue = G.forcedOffers || (G.forcedOffers = []);
  const force = id => {
    queue.push(id);
    if (G.phase === 'draft') G.offers = G.makeOffers(); // reroll current draft, consuming the queue
    bump(); G.render();
  };
  const opts = POWERUP_LIST.slice().sort((a, b) => a.name.localeCompare(b.name));
  return h`<div className="tester">
    ${open ? h`<div className="tester-body">
      <div className="tester-title">🧪 Tester tools</div>
      <div className="tester-row">
        <select value=${sel} onChange=${e => setSel(e.target.value)}>
          ${opts.map(d => h`<option key=${d.id} value=${d.id}>${d.icon} ${d.name}${d.disabled ? ' (pool-disabled)' : ''}</option>`)}
        </select>
        <button onClick=${() => force(sel)}>Force</button>
      </div>
      <div className="tester-row">
        <button onClick=${() => force('chomper')}>😬 Force Chomper</button>
        ${queue.length ? h`<button onClick=${() => { queue.length = 0; bump(); }}>Clear queue (${queue.length})</button>` : null}
      </div>
      <div className="tester-hint">Lands in the next draft's first slot (bypasses gates). During a draft it rerolls the offers immediately. Forced drafts are excluded-able in telemetry.</div>
    </div>` : null}
    <button className="tester-toggle" title="Tester tools" onClick=${() => setOpen(!open)}>🧪</button>
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
        // queue a power-up into the next draft's first slot (🧪 panel parity)
        forceOffer(id) { (G.forcedOffers = G.forcedOffers || []).push(id); if (G.phase === 'draft') { G.offers = G.makeOffers(); } G.render(); },
      },
    };
  }
  const G = ref.current;
  let screen;
  if (G.phase === 'menu') screen = h`<${MenuScreen} G=${G} />`;
  // Every draft — the run-start one included — renders as an overlay inside
  // LevelScreen, so the board is always in view while picking.
  else if (G.phase === 'win' || G.phase === 'loss') screen = h`<${EndScreen} G=${G} />`;
  else screen = h`<${LevelScreen} G=${G} />`;
  // Everything lives inside the phone frame; overlays/callouts anchor to it.
  // Backdrop: CD art via the bg.main slot; CSS mystical placeholder until then.
  return h`<div className="phone">
    ${SKIN.has('bg.main')
      ? h`<img className="bg-main" src=${SKIN.url('bg.main')} alt="" />`
      : h`<div className="bg-main bg-main-placeholder"></div>`}
    ${screen}
    <${TesterPanel} G=${G} />
  </div>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(h`<${App} />`);
