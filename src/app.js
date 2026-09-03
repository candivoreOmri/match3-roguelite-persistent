/* ============================================================================
   Match-3 Roguelite — PERSISTENT BOARD variant ("Ascent").
   Engine and power-ups are shared: ../shared/engine.js, ../shared/powerups.js
   (loaded before this file — see index.html). This file owns: CONFIG, the
   variant's telemetry storage, the variant remaps of shared power-ups, the
   PersistentGame subclass (checkpoint run flow + per-move drip), and the UI.

   Variant rules recap: ONE board per run (never regenerates), one run-long
   bar with cumulative score checkpoints — crossing pays moves + a draft.
   v10: crossing the FINAL checkpoint ends the run as a win, and the moves
   you didn't need pay out as dice — leftover moves are the goal, not score.
   Loss only at 0 moves before the final flag.
   NEVER edit shared/* for variant-only behaviour — override here instead.
   ========================================================================== */
'use strict';

const CONFIG = {
  // Stamped into every telemetry record so balance passes only compare runs
  // played on the same rules. Bump when mechanics or targets change.
  // NOTE: the board-meta line counted v9-v14 while the blockers/food line
  // independently counted v9-v10 — v15 is the first shared number after the
  // two branches merged (2026-09-01).
  BALANCE_VERSION: 22, // v22: board-meta v16 (hub, per-world curves, blocker spawn rework) merged with main v21 (merge combos, line clears damage blockers, carry-over messaging)

  // Blockers: inert tiles cleared only through their own interaction (see
  // the BLOCKERS registry below CONFIG). Each type unlocks once
  // run.checkpointIdx reaches its intro checkpoint. Spawn modes (v16 —
  // Omri: refill-spawned blockers piled up at the top, next to each other):
  //   box   → per-MOVE drip onto a random scattered board cell
  //   water → ONE seeding event per checkpoint segment, 2-3 scattered puddles
  //   safe  → still rides the refill pool (rare, cap 1)
  BLOCKER_STATIC_BOX_CHANCE: 0.15,   // per move (drip roll), not per refill tile
  BLOCKER_WATER_SEEDS_MIN: 2,        // puddles per segment seeding event
  BLOCKER_WATER_SEEDS_MAX: 3,
  BLOCKER_COLOR_SAFE_CHANCE: 0.05,   // per refill tile
  BLOCKER_BOX_BOMBS_MIN: 2,          // bombs from a cracked box (1 in place + rest scattered)
  BLOCKER_BOX_BOMBS_MAX: 3,
  BLOCKER_SCATTER_DIST: 2,           // min Chebyshev distance between same-type blockers on spawn
  // v15 merge remap: the original gates (3/5/7) were tuned for the endless
  // pre-v10 game — runs now END at the final flag (3 flags on world-1
  // regular runs, 6 on bosses/worlds 2-3), which made water barely reachable
  // and safes IMPOSSIBLE. Remapped so each blocker gets real screen time in
  // a 6-flag run; world-1 regular runs (3 flags) only ever meet the box.
  // Needs a proper per-world design pass (flagged in the PR).
  BLOCKER_INTRO_CHECKPOINT_BOX: 2,
  BLOCKER_INTRO_CHECKPOINT_WATER: 3,
  BLOCKER_INTRO_CHECKPOINT_SAFE: 4,
  BLOCKER_STATIC_BOX_HITS: 3,
  BLOCKER_WATER_SPREAD_INTERVAL: 1,  // water spreads every Nth player move
  BLOCKER_COLOR_SAFE_COLORS_REQUIRED: 4, // of 5 (all of them when fewer colours are active)
  BLOCKER_CAPS: { box: 3, water: 6, safe: 1 }, // concurrent per type (water counts seeds+spread — a new seeding skips while the board is still wet)
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
  // v10: crossing the LAST checkpoint ends the run — leftover moves are the
  // prize (1 die each) — and each world has its own curve, because each world
  // only has its unlocked power-up batches. World 1 (batch 1: no multipliers,
  // sweeps, or spawners) is flattened AND lowered — the old curve went
  // super-linear to chase a scaling economy that batch 1 doesn't have.
  // Tuned with a greedy scripted bot (sensible drafts, best-immediate-match
  // moves): ~50% win rate, 3-11 leftover moves on wins, most losses past
  // checkpoint 3. World 2 ≈ 0.85× the full tuning (batches 1+2 hold most of
  // the score engines); world 3 is the original v3 full-roster curve.
  // v13: regular and boss runs have SEPARATE curves per world (v12 sliced
  // the first 3 flags off the boss curve for regular runs — but those were
  // the gentle onboarding segments of a 6-flag climb, which made regular
  // world-1 runs trivial, and any early-flag raise instantly bricked the
  // 6-colour boss opening; one array can't serve both).
  // A regular run's flag count = its curve's length.
  // World-1 regular retune (greedy bot, 18 seeds): 39% bot win rate with
  // 0-6 leftover moves — photo finishes instead of the old 58%-with-13-spare.
  WORLD_CHECKPOINTS: [
    [45, 110, 220],
    [68, 213, 442, 765, 1275, 2125],
    [80, 250, 520, 900, 1500, 2500],
  ],
  // Boss curves — always the full climb. NOTE: the bot is a bad proxy at 6
  // colours (it goes 0/12 even on the curve Omri cruised), so the w1 boss is
  // tuned by RELATIVE bot progress: this curve pushes the bot's median reach
  // from flag 3 down to flag 2 vs the "very very easy" v12 curve (~one
  // notch harder overall, with a heavier tail). Human telemetry decides next.
  WORLD_BOSS_CHECKPOINTS: [
    [40, 100, 200, 330, 500, 720],
    [68, 213, 442, 765, 1275, 2125],
    [80, 250, 520, 900, 1500, 2500],
  ],
  // v11: moves are per-world too — world 1 was "too easy and too long"
  // (Omri), so it now runs ~half as long (9 start + 6-8 grants ≈ 42-move
  // budget) with a curve that's gentle while you have no engine (seg1 needs
  // ~4 pts/move) and steep once you should (seg6 ~25) — bot retune: 25%
  // win rate at 33-42 moves/run, 2-10 leftover moves on wins, losses spread
  // over checkpoints 1-5 instead of clustering early. Worlds 2/3 keep the
  // v6 full-roster tuning. Last grant slot is unused since v10 (the final
  // flag ends the run).
  WORLD_START_MOVES: [9, 10, 10],  // opening move pool per world
  // v14: world-1 grants trimmed by 1 each (Omri: checkpoint refills too
  // generous). With the v13 curve this lands the bot at 22% wins (was 39%),
  // finishing with 0-7 moves to spare — surplus now has to be EARNED
  // (momentum / xtra-move refunds), not granted. Worlds 2/3 untouched.
  WORLD_CHECKPOINT_MOVES: [
    [5, 5, 6, 6, 7],
    [8, 10, 11, 12, 13],
    [8, 10, 11, 12, 13],
  ],
  // MERGE NOTE (2026-09-02, Omri OoO): main's single-curve CHECKPOINTS /
  // START_MOVES / CHECKPOINT_MOVES (v16 ease + v19 interim art ease) are NOT
  // carried here — the board-meta line replaced them with the per-world tables
  // above. Worlds 2/3 still run the pre-ease v3 curve; revisit when Omri is back.
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

  /* ----- Board meta layer (v9) — dice economy + the board-game loop ----- */
  DICE_MIN_ON_WIN: 1,              // a won run always pays at least this many dice
  DICE_PER_LEFTOVER_MOVE: 1,       // dice per banked move left when a run is won
  DICE_ON_PARTIAL_CLEAR: 1,        // reached PARTIAL_CLEAR_CHECKPOINT but lost
  PARTIAL_CLEAR_CHECKPOINT: 3,     // "partial clear" = crossed at least this checkpoint
  DICE_ON_LOSS: 0,
  // v11: the cap is NOT enforced on earnings any more — earned/bought dice
  // stack freely. Kept as the threshold for a future refill mechanic.
  DICE_CAP: 10,
  DICE_PRICE_COINS: 50,            // buy one die for coins on the board hub
  DIE_SIDES: 6,
  BOARD_SPACES: 20,                // one lap = one full loop of the board
  STARTING_DICE: 3,                // dice a brand-new save begins with
  LAPS_TO_UNLOCK_BOSS: [2, 7, 10], // laps in-world before the boss run unlocks, per world
  CURRENT_WORLD: 1,                // world a fresh save starts on
  BOARD_COIN_REWARD_MIN: 10,       // coin space payout range
  BOARD_COIN_REWARD_MAX: 20,
  MYSTERY_COINS_MIN: 15,           // mystery box coin outcome range
  MYSTERY_COINS_MAX: 50,
  SCRATCH_CARD_SMALL: 15,          // scratch card: no matching symbols
  SCRATCH_CARD_MEDIUM: 50,         // two symbols match
  SCRATCH_CARD_JACKPOT: 150,       // all three match
  COIN_FLIP_HEADS: 30,
  COIN_FLIP_TAILS: 15,
  JACKPOT_COINS: 100,              // "Jackpot" meta power-up offer payout
  LANDMARK_MOVE_BONUS: 1,          // starting moves granted per completed lap

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
    mode:   'drip', // per-move roll, placed on a scattered board cell (v16)
    intro:  () => CONFIG.BLOCKER_INTRO_CHECKPOINT_BOX,
    chance: () => CONFIG.BLOCKER_STATIC_BOX_CHANCE,
    cap:    () => CONFIG.BLOCKER_CAPS.box,
    make:   () => ({ hits: CONFIG.BLOCKER_STATIC_BOX_HITS }),
  },
  water: {
    mode:   'segment', // one seeding event per checkpoint segment, 2-3 puddles (v16)
    intro:  () => CONFIG.BLOCKER_INTRO_CHECKPOINT_WATER,
    seedRange: () => [CONFIG.BLOCKER_WATER_SEEDS_MIN, CONFIG.BLOCKER_WATER_SEEDS_MAX],
    cap:    () => CONFIG.BLOCKER_CAPS.water,
    make:   () => ({}),
  },
  safe: {
    mode:   'refill',
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
  configurable: true, // the board-meta batch gate re-wraps this getter below
  get() {
    const m = ACTIVE_GAME && ACTIVE_GAME.mods;
    return !(m && (m.bombChance > 0 || m.squareBomb || m.chomperBomb));
  },
});

/* ========================== BOARD META LAYER ===============================
   A board-game hub that wraps the runs: after each run the player returns to
   a circular 20-space board and spends dice (earned by runs) to move a token
   around it. Spaces pay coins/consumables/run-modifiers/mini-games; laps
   unlock a boss run; beating the boss advances the world, which auto-unlocks
   the next power-up batch in the draft pool.
   Everything below is DATA (worlds, space layouts, modifiers, batches) —
   adding a space type, world, or mini-game must not require engine edits.
   The meta layer uses Math.random on purpose: it is not part of the seeded,
   replayable run — only in-run state rides the seeded RNG.
   ========================================================================== */

/* ----- Run modifiers — granted by board spaces, expire after ONE run -----
   Declarative hooks the run reads: startMoves (± starting moves),
   cpBonus (± moves per checkpoint grant), colours (forced colour count),
   onRunStart(g) (arbitrary setup once the board exists).
   negative:true marks boss handicaps (styled red, announced pre-run). */
const RUN_MODIFIERS = {
  cpmoves:      { id: 'cpmoves', icon: '🚩', name: 'Trail rations',
                  desc: '+1 move on every checkpoint grant this run', cpBonus: 1 },
  first2x:      { id: 'first2x', icon: '✨', name: 'Opening act',
                  desc: 'Your first match of the run scores ×2', onRunStart(g) { g.first2x = true; } },
  startspecial: { id: 'startspecial', icon: '🎆', name: 'Head start',
                  desc: 'One random special piece on the board at run start',
                  onRunStart(g) { g.placeRandomSpecial(); } },
  landmark:     { id: 'landmark', icon: '🏠', name: 'Home advantage',
                  desc: `+${CONFIG.LANDMARK_MOVE_BONUS} starting move (completed lap)`,
                  startMoves: CONFIG.LANDMARK_MOVE_BONUS },
  boss6:        { id: 'boss6', icon: '🌈', name: 'Six colours',
                  desc: 'BOSS: the board uses 6 tile colours this run', negative: true, colours: 6 },
  bosscold:     { id: 'bosscold', icon: '🥶', name: 'Cold start',
                  desc: 'BOSS: start the run with 2 fewer moves', negative: true, startMoves: -2 },
};

/* ----- Meta power-ups — board offers that pay META rewards, no in-run power */
const META_POWERUPS = {
  jackpot: { id: 'jackpot', icon: '💰', name: 'Jackpot',
             desc: `Awards ${CONFIG.JACKPOT_COINS} coins immediately. No in-run effect.`,
             apply() { META.addCoins(CONFIG.JACKPOT_COINS); } },
};

/* ----- Consumables — dropped by board spaces (shop pool). Inventory only for
   now: in-run usage is a separate feature, the board just banks them. */
const CONSUMABLES = {
  hammer:  { id: 'hammer', icon: '🔨', name: 'Hammer' },
  bomb:    { id: 'bomb', icon: '🧨', name: 'Bomb' },
  shuffle: { id: 'shuffle', icon: '🔀', name: 'Shuffle' },
};

/* ----- Space types — visual identity per type; behaviour lives in the board
   UI's landing resolver, which switches on these ids. Add a type here + a
   case in resolveLanding and it works on any world's layout. */
const SPACE_TYPES = {
  landmark:         { icon: '🏠', label: 'Home', cls: 'landmark' },
  coin:             { icon: '🪙', label: 'Coins', cls: 'coin' },
  consumable:       { icon: '🧰', label: 'Item drop', cls: 'consumable' },
  modifier:         { icon: '🔮', label: 'Run modifier', cls: 'modifier' },
  mystery:          { icon: '❔', label: 'Mystery box', cls: 'mystery' },
  minigame_flip:    { icon: '🎰', label: 'Coin flip', cls: 'minigame' },
  minigame_scratch: { icon: '🎫', label: 'Scratch card', cls: 'minigame' },
  metaoffer:        { icon: '💼', label: 'Meta offer', cls: 'metaoffer' },
  empty:            { icon: '·', label: 'Flavour', cls: 'empty' },
  boss:             { icon: '👹', label: 'BOSS', cls: 'boss' },
};

/* ----- Worlds — layout is 20 space-type ids, clockwise from Home at 0.
   Composition (world 1 spec): coin×4, consumable×2, modifier×3, mystery×2,
   mini-game×2, meta offer×1, landmark×1, empty×3 = 18 — padded with +1 coin
   and +1 empty to fill the 20 spaces. Empty spaces are dead beats: landing
   on one does nothing (v11 — flavour text cut). The boss is NOT a space:
   once unlocked it takes over the Start-run button (v11). */
const WORLD_LAYOUT = [
  'landmark',          //  0 — Home
  'coin', 'empty', 'modifier', 'mystery',                    //  1-4
  'coin', 'consumable', 'minigame_flip', 'modifier', 'coin', //  5-9
  'empty',                                                   // 10
  'minigame_scratch', 'consumable', 'coin', 'mystery',       // 11-14
  'modifier', 'empty', 'metaoffer', 'coin', 'empty',         // 15-19
];
const WORLDS = [
  { id: 1, name: 'Meadow Hollow', icon: '🌿',
    lapsForBoss: CONFIG.LAPS_TO_UNLOCK_BOSS[0],
    boss: { name: 'Prism Guardian', icon: '🌈', modifiers: ['boss6'] },
    modifierPool: ['cpmoves', 'first2x', 'startspecial'],
    metaOffers: ['jackpot'],
    spaces: WORLD_LAYOUT },
  { id: 2, name: 'Ember Dunes', icon: '🏜️',
    lapsForBoss: CONFIG.LAPS_TO_UNLOCK_BOSS[1],
    boss: { name: 'Dune Colossus', icon: '🗿', modifiers: ['bosscold'] },
    modifierPool: ['cpmoves', 'first2x', 'startspecial'],
    metaOffers: ['jackpot'],
    spaces: WORLD_LAYOUT },
  { id: 3, name: 'Frost Summit', icon: '🏔️',
    lapsForBoss: CONFIG.LAPS_TO_UNLOCK_BOSS[2],
    boss: { name: 'Summit Wyrm', icon: '🐉', modifiers: ['boss6', 'bosscold'] },
    modifierPool: ['cpmoves', 'first2x', 'startspecial'],
    metaOffers: ['jackpot'],
    spaces: WORLD_LAYOUT },
];

/* ----- Power-up batches — which world unlocks which draft-pool picks.
   Pure data: reaching world N makes batches 1..N available automatically
   (no unlock screen yet — that's a separate feature). Ids NOT in any batch
   never appear (benched: flood, old snowball). Ids listed here but disabled
   at the roster level (lifesaver, tempo, autoexplode) STAY out until their
   base flag flips — the batch only says which world they belong to.
   'babychomper' is a planned pick with no implementation yet — a harmless
   placeholder until its roster entry exists. */
const POWERUP_BATCHES = {
  1: ['boost', 'bombchance', 'countdown', 'expandrow', 'expandcol', 'xtramove',
      'lifesaver', 'diagswap', 'tempo', 'square', 'momentum', 'snowcrush', 'snowpaint'],
  2: ['fillup', 'spawner', 'converter', 'spawnweight', 'purge', 'blast',
      'autoexplode', 'specialscore', 'rowclear', 'colclear', 'matryoshka',
      'aftershock', 'fusionmove', 'pinata', 'tripletile', 'chests', 'conveyor',
      'chomper', 'squarescore', 'squarebomb', 'gourmet', 'buffet', 'babychomper'],
  3: ['sweep', 'lava', 'twinchomper', 'doublebite', 'spicytrail', 'bombtrail'],
};

/* ----- Persistent meta state — localStorage-backed, survives runs/reloads */
const META_KEY = 'rl_persistent_meta_v1';
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const META = {
  state: (() => {
    const defaults = {
      v: 1,
      world: CONFIG.CURRENT_WORLD,   // 1-based; drives batch unlocks + board theme
      dice: CONFIG.STARTING_DICE,    // carried between runs, uncapped (v11)
      coins: 0,
      pos: 0,                        // token position on the 20-space loop
      laps: 0,                       // lifetime laps (display)
      worldLaps: 0,                  // laps in the CURRENT world — unlocks its boss
      consumables: { hammer: 0, bomb: 0, shuffle: 0 },
      modifiers: [],                 // active run modifiers [{id}], expire after one run
      bossDefeated: [],              // world ids whose boss run has been cleared
      boardSpeed: 1,                 // board animation speed ×1/×2/×3 (dice + token)
    };
    try {
      const saved = JSON.parse(localStorage.getItem(META_KEY));
      if (saved && saved.v === 1) return { ...defaults, ...saved, consumables: { ...defaults.consumables, ...saved.consumables } };
    } catch (e) { /* corrupt / unavailable — start fresh */ }
    return defaults;
  })(),
  save() {
    try { localStorage.setItem(META_KEY, JSON.stringify(this.state)); } catch (e) { /* prototype keeps playing */ }
  },
  world() { return WORLDS[Math.min(this.state.world, WORLDS.length) - 1]; },
  bossUnlocked() {
    return this.state.worldLaps >= this.world().lapsForBoss && !this.state.bossDefeated.includes(this.state.world);
  },
  campaignDone() { return this.state.bossDefeated.includes(WORLDS.length); },
  // v11: gains are UNCAPPED (DICE_CAP is reserved for a future refill
  // mechanic) — only the floor at 0 is enforced. Returns the actual delta.
  addDice(n) {
    const before = this.state.dice;
    this.state.dice = Math.max(0, before + n);
    this.save();
    return this.state.dice - before;
  },
  buyDie() {
    if (this.state.coins < CONFIG.DICE_PRICE_COINS) return false;
    this.state.coins -= CONFIG.DICE_PRICE_COINS;
    this.state.dice += 1;
    this.save();
    return true;
  },
  addCoins(n) { this.state.coins += n; this.save(); },
  addConsumable(id) { this.state.consumables[id] = (this.state.consumables[id] || 0) + 1; this.save(); },
  addModifier(id) { this.state.modifiers.push({ id }); this.save(); },
  // Crossing Home = one lap: counts everywhere it should and banks the
  // landmark's +1 starting move for the next run (stacks per lap).
  onLap() {
    this.state.laps++; this.state.worldLaps++;
    this.state.modifiers.push({ id: 'landmark' });
    this.save();
  },
  // Boss cleared: next world (if any) — new board, lap counter reset, next
  // power-up batch unlocks implicitly because `world` grew. Returns whether
  // a next world actually exists.
  advanceWorld() {
    if (!this.state.bossDefeated.includes(this.state.world)) this.state.bossDefeated.push(this.state.world);
    if (this.state.world >= WORLDS.length) { this.save(); return false; }
    this.state.world++;
    this.state.worldLaps = 0;
    this.state.pos = 0;
    this.save();
    return true;
  },
};

/* ----- World-gated draft pool — wraps every roster entry's `disabled` so
   shared makeOffers only sees picks whose batch the player has reached.
   Composes with existing flags/getters (tempo's manual disable, blast's
   dynamic bomb-source gate) instead of replacing them; assignment still
   works later via the setter. NO shared/* edits. */
{
  const BATCH_OF = {};
  for (const [w, ids] of Object.entries(POWERUP_BATCHES)) for (const id of ids) BATCH_OF[id] = +w;
  for (const def of POWERUP_LIST) {
    const d = Object.getOwnPropertyDescriptor(def, 'disabled');
    const baseGet = d && d.get ? d.get.bind(def) : null;
    let manual = d && !d.get ? d.value : undefined;
    Object.defineProperty(def, 'disabled', {
      configurable: true,
      get() {
        const own = manual !== undefined ? manual : (baseGet ? baseGet() : false);
        const batch = BATCH_OF[def.id];
        return !!own || batch === undefined || batch > META.state.world;
      },
      set(v) { manual = v; },
    });
  }
}

/* --------------------------- Card copy pass -------------------------------
   v21.1 (Omri, 2026-09-01): shorter, verb-first card text — one line per
   power-up, numbers only where they change a decision. Edit freely; this
   block is applied LAST so it wins over the mechanic patches above.
   (Colour boost keeps its dynamic desc — it needs the rolled colour.) */
const CARD_COPY = {
  fillup:      () => 'Match boosted tiles to charge a +1 score multiplier (one charge — pick again for more)',
  spawner:     () => 'Boosted matches can spawn special pieces (stacks)',
  converter:   () => 'Every match you make turns one tile into your boosted colour',
  spawnweight: () => 'Boosted colours drop in more often (stacks)',
  purge:       () => 'Your 4+ matches clear that whole colour',
  sweep:       () => 'Your vertical matches clear that whole colour',
  snowcrush:   () => 'Destroy specials to charge the snowball — every full bar adds +3 to all your matches (stacks)',
  snowpaint:   () => 'Boosted matches charge the snowball — every full bar adds +3 to all your matches',
  bombchance:  () => 'New tiles can drop in as bombs (stacks)',
  countdown:   () => ACTIVE_GAME && ACTIVE_GAME.run && ACTIVE_GAME.run.picks.some(p2 => p2.id === 'countdown')
    ? 'Shorter fuse — specials now explode the move they appear'
    : 'Specials explode on their own after 2 moves (pick again for a shorter fuse)',
  blast:       () => 'Bombs blast one ring bigger (stacks)',
  specialscore:() => 'Specials score +1 when they blow (stacks)',
  rowclear:    () => 'Your sideways matches clear the whole row',
  colclear:    () => 'Your up-down matches clear the whole column',
  matryoshka:  () => 'Exploding specials leave a smaller special behind',
  aftershock:  () => 'Explosions scorch nearby tiles — match one for a bonus blast',
  fusionmove:  () => 'Merge two specials to get +1 move',
  lava:        () => 'The bottom row melts away after every move',
  expandrow:   () => 'The board grows by a row (stacks)',
  expandcol:   () => 'The board grows by a column (stacks)',
  xtramove:    () => 'Match over 🔄 tiles to get a move back (pick again for more tiles)',
  square:      () => '2×2 squares count as matches and spawn a dynamite',
  squarebomb:  () => 'Squares spawn a bomb instead',
  squarescore: () => 'Square tiles score double',
  momentum:    () => 'Make 4+ matches to get extra moves (stacks)',
  pinata:      () => 'Piñatas appear — hit one 5 times for +50',
  tripletile:  () => 'A ×3 tile appears — match over it to triple that whole move',
  chests:      () => 'Chests drop in — carry them to the bottom for points or moves',
  diagswap:    () => 'You can swap diagonally',
  conveyor:    () => 'The board\'s outer ring rotates after every move',
  chomper:     () => 'A hungry critter eats one piece after each move — 🍖 snacks pay +20, specials go boom',
  twinchomper: () => 'A second Chomper joins the board',
  doublebite:  () => 'Chomper takes an extra bite each move (stacks)',
  gourmet:     () => 'Pieces Chomper eats score double',
  spicytrail:  () => 'Chomper\'s trail stays scorched — match it for bonus blasts',
  bombtrail:   () => 'Chomper leaves live bombs behind him',
  buffet:      () => '2 more 🍖 snacks on the board (stacks)',
};
for (const [id, desc] of Object.entries(CARD_COPY)) if (POWERUPS[id]) POWERUPS[id].desc = desc;

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
    // v20: per-blocker pre-run toggles — OFF by default (Omri). The intro
    // checkpoints still gate spawn timing for any type switched on.
    this.opts.blockers = { box: false, water: false, safe: false };
    this.marks = new Set();
    this.drip = { pinata: 0, chest: 0, triple: 0 }; // dry-move pity counters
    this.pendingChests = 0;      // chests queued to ride in on the next refill
    this.segPeak = 0; this.segClipped = 0; this.segDanger = 0; this.segFood = 0; // cap/food telemetry, per segment
    this.segBlockers = { box: 0, water: 0, safe: 0 };
    this.foodCells = new Set();
    this.runMods = [];           // board-granted run modifiers, snapshotted per run
    this.bossRun = false;
    this.runReward = null;       // {dice, bossCleared, worldAdvanced} for the end screen
    this.armed = null;           // consumable awaiting a board tap ('hammer' | 'bomb')
  }

  /* ------------------- Board-meta run modifier plumbing ------------------ */
  runModDefs() { return this.runMods.map(m => RUN_MODIFIERS[m.id]).filter(Boolean); }
  runModStartMoves() { return this.runModDefs().reduce((s, d) => s + (d.startMoves || 0), 0); }
  runModCpBonus() { return this.runModDefs().reduce((s, d) => s + (d.cpBonus || 0), 0); }

  // "Head start" modifier: one random special on the board at run start.
  placeRandomSpecial() {
    let guard = 0;
    while (guard++ < 300) {
      const k = this.rollInteriorCell();
      const [r, c] = k.split(',').map(Number);
      const t = this.board[r][c];
      if (!t || t.special || t.chest || t.chomper) continue;
      t.special = ['bomb', 'arrow', 'lightning'][Math.floor(this.rng() * 3)];
      t.dir = t.special === 'arrow' ? (this.rng() < 0.5 ? 'h' : 'v') : null;
      if (this.mods.countdown) t.countdown = CONFIG.COUNTDOWN_TIMER_START;
      t.fresh = true;
      this.addFx(r, c, '🎆', 'emoji');
      return;
    }
  }

  // Run ended (win or loss): pay the dice economy, settle the boss, expire
  // every board modifier. Single exit point — checkLevelEnd calls it right
  // after the phase flips to win/loss.
  finishRunMeta(win) {
    const leftover = Math.max(0, this.movesLeft);
    // Partial clear scales with the run's flag count: on a short (3-flag)
    // run the consolation die comes from reaching the second-to-last flag.
    const partialAt = Math.min(CONFIG.PARTIAL_CLEAR_CHECKPOINT, this.checkpoints().length - 1);
    let dice;
    if (win) dice = Math.max(CONFIG.DICE_MIN_ON_WIN, leftover * CONFIG.DICE_PER_LEFTOVER_MOVE);
    else if (this.run.checkpointIdx >= partialAt) dice = CONFIG.DICE_ON_PARTIAL_CLEAR;
    else dice = CONFIG.DICE_ON_LOSS;
    this.runReward = { dice: META.addDice(dice), bossCleared: false, worldAdvanced: false };
    if (this.bossRun && win) {
      this.runReward.bossCleared = true;
      this.runReward.worldAdvanced = META.advanceWorld();
    }
    META.state.modifiers = []; // every board modifier expires after one run — used or not
    META.save();
    // undo a boss colour-count override
    if (this.savedColours !== undefined) { this.opts.colours = this.savedColours; this.savedColours = undefined; }
  }

  backToBoard() {
    if (this.phase !== 'win' && this.phase !== 'loss') return;
    this.phase = 'menu'; // 'menu' renders the board hub
    this.board = null;
    this.busy = false;
    this.render();
  }

  /* ----- In-run consumables (v12) — board-earned items, META inventory.
     No move cost. Hammer and bomb resolve through the engine's normal step
     pipeline (explodeSeeds), so special chains, gravity, cascades, scoring,
     and checkpoint crossings all just work. `armed` is the targeting mode:
     the next board tap is the target instead of a swap. */
  async useConsumable(kind, cell) {
    if (this.phase !== 'level' || this.busy) return;
    const inv = META.state.consumables;
    if (!(inv[kind] > 0)) return;
    this.armed = null;
    if (kind === 'shuffle') {
      inv.shuffle--; META.save();
      this.busy = true;
      this.callout('🔀 Shuffled!');
      this.reshuffleBoard();
      this.render();
      await this.sleep(300);
      this.busy = false;
      this.render();
      return;
    }
    if (!cell) return;
    const t = this.board[cell.r] && this.board[cell.r][cell.c];
    if (!t || t.chest || t.chomper || t.blocker) { // indestructible / blocker target — keep the item
      if (t) { t.wiggle = true; this.render(); setTimeout(() => { delete t.wiggle; this.render(); }, 380); }
      this.render();
      return;
    }
    inv[kind]--; META.save();
    this.busy = true;
    this.addFx(cell.r, cell.c, kind === 'hammer' ? '🔨' : '🧨', 'emoji');
    if (kind === 'bomb') { t.special = 'bomb'; t.countdown = null; this.doShake(8); }
    // hammer on a special DETONATES it; on a plain tile the pseudo-special
    // 'hammer' clears exactly that one tile (explosionCells → no extras)
    else if (!t.special) { t.special = 'hammer'; t.countdown = null; }
    await this.explodeSeeds([cell]);
    this.checkLevelEnd();
    this.busy = false;
    this.render();
  }

  // ("Opening act" first-match ×2 lives in the processStep override below,
  // merged with the blocker step effects — a class can only define it once.)

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

  // opts.boss starts the current world's boss run: its negative modifiers
  // join the run's modifier list (announced on the board before starting).
  newRun(seed, opts = {}) {
    this.bossRun = !!opts.boss;
    // Snapshot the board-granted modifiers for this run. They expire at run
    // end (finishRunMeta) — a mid-run reload never ends the run, so they
    // survive to the next attempt, which favours the player.
    this.runMods = META.state.modifiers.map(m => ({ ...m }));
    if (this.bossRun) for (const id of META.world().boss.modifiers) this.runMods.push({ id });
    this.runReward = null;
    this.armed = null;
    // Boss "Six colours": force the colour count for this run only —
    // finishRunMeta restores the player's own setting afterwards. If a
    // previous run never finished (debug/cheat paths), undo its force first.
    if (this.savedColours !== undefined) { this.opts.colours = this.savedColours; this.savedColours = undefined; }
    const forced = this.runModDefs().find(d => d.colours);
    if (forced) { this.savedColours = this.opts.colours; this.opts.colours = forced.colours; }
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
  // Regular and boss runs read separate per-world curves (v13) — a regular
  // run's flag count is just its curve's length. The world can't change
  // mid-run, so a live read is safe.
  checkpoints() {
    const s = CONFIG.COLOUR_TARGET_SCALE[this.opts.colours] || 1;
    const table = this.bossRun ? CONFIG.WORLD_BOSS_CHECKPOINTS : CONFIG.WORLD_CHECKPOINTS;
    const base = table[Math.min(META.state.world, table.length) - 1];
    return base.map(v => Math.round(v * s));
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
    this.seedSegmentBlockers(); // v16: water's once-per-segment flood lands with the new segment
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
    // board modifiers adjust the opening pool (landmark laps +, boss cold start −)
    const startMoves = CONFIG.WORLD_START_MOVES[Math.min(META.state.world, CONFIG.WORLD_START_MOVES.length) - 1];
    this.movesLeft = Math.max(1, startMoves + this.runModStartMoves());
    this.segPeak = this.movesLeft; this.segClipped = 0; this.segDanger = 0; this.segFood = 0; this.segBlockers = { box: 0, water: 0, safe: 0 };
    this.segBlockerSeeded = {}; // segment-mode blockers: type -> checkpointIdx last seeded (v16)
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
    this.first2x = false;
    for (const d of this.runModDefs()) if (d.onRunStart) d.onRunStart(this); // board modifiers with setup hooks
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
      this.dripBlockers(); // v16: boxes land scattered on the board, not in the refill lane
      this.topUpFood(); // the table never runs low (no-op without Chomper)
      if (this.movesLeft <= 3) this.segDanger++; // moves played under the gun (cap-tuning telemetry)
    }
  }

  // Replaces per-level clear/loss: cross every checkpoint the score now
  // clears (grant moves + queue drafts). v10: crossing the FINAL checkpoint
  // ENDS the run as a win — the moves you didn't need become dice, so
  // leftover moves are the prize, not a springboard for more score.
  checkLevelEnd() {
    if (this.phase !== 'level') return;
    const cps = this.checkpoints();
    let crossed = 0, granted = 0;
    while (this.run.checkpointIdx < cps.length && this.score >= cps[this.run.checkpointIdx]) {
      const i = this.run.checkpointIdx++;
      if (this.run.checkpointIdx >= cps.length) { // final flag — run over, bank the surplus
        this.run.finalReached = true;
        this.logLevel('end');
        this.phase = 'win';
        this.finishRunMeta(true); // dice payout (1/leftover move), boss settle, modifier expiry
        return;
      }
      const grants = CONFIG.WORLD_CHECKPOINT_MOVES[Math.min(META.state.world, CONFIG.WORLD_CHECKPOINT_MOVES.length) - 1];
      const grant = grants[Math.min(i, grants.length - 1)]
                  + this.runModCpBonus(); // board modifier: +1 per Trail rations
      const before = this.movesLeft;
      this.movesLeft += grant;
      granted += this.movesLeft - before; crossed++; // overlay shows what the cap actually let through
      this.logLevel('clear');
      this.run.pendingDrafts++;
      this.tempoUsed = false; // Tempo re-arms for the new segment
    }
    if (crossed) {
      this.lastCheckpoint = { n: this.run.checkpointIdx, crossed, moves: granted,
                              kept: this.movesLeft - granted, total: this.movesLeft, // carry-over made visible
                              final: this.run.finalReached };
      this.addFx(0.2, this.cols / 2 - 0.5, `👟 +${granted}`, 'gold big');
      this.phase = 'checkpoint';
      return;
    }
    if (this.movesLeft <= 0) {
      if (this.mods.lifesaver && !this.run.lifesaverUsed) {
        this.run.lifesaverUsed = true;
        this.movesLeft += CONFIG.LIFESAVER_BONUS_MOVES;
        this.callout(`🛟 Lifesaver! +${CONFIG.LIFESAVER_BONUS_MOVES} moves`);
      } else {
        this.logLevel('loss');
        this.phase = 'loss';
        this.finishRunMeta(false); // dice payout (partial clear), modifier expiry
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
      world: META.state.world, boss: !!this.bossRun, // board meta context
      runMods: this.runMods.map(m => m.id),
      foodEaten: this.segFood || 0,  // chomper snacks eaten this segment
      blockers: { ...this.segBlockers }, // boxes broken / water removed / safes opened
      blockersOn: Object.keys(this.opts.blockers || {}).filter(k => this.opts.blockers[k]), // v20 toggles (unused here — board-meta gates by world)
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
      if (def.mode !== 'refill') continue; // drip/segment types place directly on the board (v16) // (main's v20 pre-run toggles default OFF and would mute world-gated blockers — not applied)
      if (this.run.checkpointIdx < def.intro()) continue; // chance is 0 before the intro checkpoint
      if (this.blockerCount(type) >= def.cap()) continue;
      if (this.rng() < def.chance())
        return { id: this.tileId++, color: -4, blocker: type, ...def.make(),
                 special: null, dir: null, countdown: null, fresh: true };
    }
    return null;
  }

  // A random cell suitable for a blocker to land on: a plain coloured tile
  // (no specials, chests, critters, other blockers), no cell marks, not the
  // top row (refill lane), and at least BLOCKER_SCATTER_DIST away from every
  // same-type blocker — relaxes to adjacent-only if the board is too full.
  blockerScatterSpot(type) {
    const others = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++)
      if (this.board[r][c] && this.board[r][c].blocker === type) others.push({ r, c });
    for (const minDist of [CONFIG.BLOCKER_SCATTER_DIST, 1]) {
      let guard = 0;
      while (guard++ < 150) {
        const r = 1 + Math.floor(this.rng() * (this.rows - 1)); // never the top row
        const c = Math.floor(this.rng() * this.cols);
        const k = K(r, c);
        if (this.marks.has(k) || this.pinatas.has(k) || this.triples.has(k) || this.foodCells.has(k)) continue;
        const t = this.board[r][c];
        if (!t || t.special || this.protectedTile(t)) continue;
        if (others.some(o => Math.max(Math.abs(o.r - r), Math.abs(o.c - c)) < minDist)) continue;
        return { r, c };
      }
    }
    return null;
  }

  placeBlocker(type) {
    const spot = this.blockerScatterSpot(type);
    if (!spot) return false;
    const def = BLOCKERS[type];
    this.board[spot.r][spot.c] = { id: this.tileId++, color: -4, blocker: type, ...def.make(),
                                   special: null, dir: null, countdown: null, fresh: true };
    this.addFx(spot.r, spot.c, type === 'box' ? '📦' : type === 'water' ? '💧' : '🔒', 'emoji');
    return true;
  }

  // Drip-mode blockers (box): one roll per player move, placed scattered.
  dripBlockers() {
    for (const [type, def] of Object.entries(BLOCKERS)) {
      if (def.mode !== 'drip') continue;
      if (this.run.checkpointIdx < def.intro()) continue;
      if (this.blockerCount(type) >= def.cap()) continue;
      if (this.rng() < def.chance()) this.placeBlocker(type);
    }
  }

  // Segment-mode blockers (water): ONE seeding event per checkpoint segment —
  // 2-3 puddles scattered across the board. Skipped while the previous
  // flood is still on the board (cap counts seeds + spread).
  seedSegmentBlockers() {
    for (const [type, def] of Object.entries(BLOCKERS)) {
      if (def.mode !== 'segment') continue;
      if (this.run.checkpointIdx < def.intro()) continue;
      if (this.segBlockerSeeded[type] === this.run.checkpointIdx) continue; // once per segment
      this.segBlockerSeeded[type] = this.run.checkpointIdx;
      if (this.blockerCount(type) >= def.cap()) continue;
      const [lo, hi] = def.seedRange();
      const n = lo + Math.floor(this.rng() * (hi - lo + 1));
      let placed = 0;
      for (let i = 0; i < n; i++) if (this.placeBlocker(type)) placed++;
      if (placed && type === 'water') this.callout('💧 Water is seeping in!');
    }
  }

  // Match-time blocker effects, same timing as other match effects: the
  // shared processStep stamps group.active, then this runs. Boxes and safes
  // count PLAYER matches only; water is removed by any match (cascades too),
  // and removing a water chain-removes the connected puddle.
  processStep(groups, swapCells, seeds, boardClears = []) {
    const before = this.score; // for the "Opening act" board modifier below
    this._blockerHitStep = new Set(); // one damage event per blocker per step (v21)
    const res = super.processStep(groups, swapCells, seeds, boardClears);
    if (groups.length) this.blockerMatchEffects(groups);
    // (v21: special explosions damage blockers through the hit set inside the
    //  step pipeline — board-meta's blockerExplosionEffects pass is superseded)
    // "Opening act" board modifier: the run's first scoring step pays double.
    if (this.first2x && res.cnt) {
      this.first2x = false;
      const gained = this.score - before;
      if (gained > 0) {
        this.score += gained;
        res.pts += gained;
        this.callout(`✨ First match ×2! +${gained}`);
      }
    }
    return res;
  }

  // v21: EVERY clear attempt that lands on a blocker damages it — explosions
  // (as before) and now also row/column clears, sweeps, and purges (tester:
  // 'row clear doesn't affect blockers'). Boxes take 1 hit, water is removed
  // (chain rule), safes light the source special's colour when the hit came
  // from an explosion ('e{r},{c}' src carries the exploding piece), otherwise
  // one random unlit colour (same rule as Chomper bumps).
  onTileProtected(r, c, t, opts) {
    if (!t.blocker) return; // chests/chompers stay silently indestructible
    if (!this._blockerHitStep) this._blockerHitStep = new Set();
    if (this._blockerHitStep.has(t.id)) return;
    this._blockerHitStep.add(t.id);
    if (t.blocker === 'water') { this.removeWaterChain(r, c); return; }
    if (t.blocker === 'box') { this.damageBox(r, c, t); return; }
    if (t.blocker === 'safe') {
      let color = -1;
      if (opts && opts.src && opts.src[0] === 'e') { // explosion: use the source special's colour
        const [sr, sc] = opts.src.slice(1).split(',').map(Number);
        const src = this.board[sr] && this.board[sr][sc];
        if (src && src.color >= 0) color = src.color;
      }
      if (color < 0) { // colourless hit (line clear etc.): one random unlit slot
        const unlit = [];
        for (let i = 0; i < this.opts.colours; i++) if (!t.lit.includes(i)) unlit.push(i);
        if (!unlit.length) return;
        color = unlit[Math.floor(this.rng() * unlit.length)];
      }
      this.lightSafe(r, c, t, color);
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

  // v21 merge combos — merging specials should feel BIG (tester feedback):
  //   ➡️+➡️  cross (full row + column)                       [base behaviour]
  //   💣+💣  MEGA bomb (blast radius +2 for this explosion)
  //   💣+➡️  the arrow upgrades to a cross, both fire
  //   ⚡+➡️  colour clear + a cross
  //   ⚡+💣  colour clear + a bigger bomb (radius +1)
  //   ⚡+⚡  NOVA — the whole board clears (board effect: scores and chains
  //          specials, fires no match hooks, marks stay — same rules as lava)
  //   anything with 🧨 keeps the sum-of-parts default
  async resolveMerge(a, b, ta, tb) {
    const pair = [ta.special, tb.special].sort().join('+');
    const boost = async (n, seeds) => {
      this.mods.blastBonus += n; // transient — computeMods rebuilds on next pick
      try { await this.explodeSeeds(seeds); } finally { this.mods.blastBonus -= n; }
    };
    if (pair === 'lightning+lightning') {
      this.callout('🌩️ NOVA!');
      this.doShake(14);
      this.addWave(b.r, b.c, Math.max(this.rows, this.cols), 0);
      const cells = [];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
        const t = this.board[r][c];
        if (t && !this.protectedTile(t)) cells.push({ r, c });
      }
      const res = this.processStep([], null, [], cells);
      if (res.cnt) {
        this.render(); await this.sleep(CONFIG.POP_MS + res.maxDelay);
        this.applyStep(res);
        await this.dropAndFill();
        this.applyFloods(res.floods);
        await this.resolveBoard(null);
      }
      return;
    }
    if (pair === 'bomb+bomb') { this.callout('💥 MEGA BOMB!'); await boost(2, [b]); return; }
    if (pair === 'bomb+lightning') { this.callout('⚡ Charged blast!'); await boost(1, [a, b]); return; }
    if (pair === 'arrow+bomb' || pair === 'arrow+lightning') {
      const arrow = ta.special === 'arrow' ? ta : tb;
      arrow.special = 'cross'; arrow.dir = null;
      this.callout(pair === 'arrow+bomb' ? '✚💣 Cross blast!' : '✚⚡ Storm cross!');
      await this.explodeSeeds([a, b]);
      return;
    }
    await super.resolveMerge(a, b, ta, tb); // arrow+arrow cross, dynamite pairs = sum of parts
  }

  damageBox(r, c, t) {
    t.hits--;
    this.addFx(r, c, t.hits > 0 ? '📦' : '💥', 'emoji');
    this.doShake(4);
    if (t.hits <= 0) { // breaks open: bombs spill out (v16 — one in place, 1-2 scatter)
      const makeBomb = () => ({ id: this.tileId++, color: Math.floor(this.rng() * this.opts.colours),
                                special: 'bomb', dir: null,
                                countdown: this.mods.countdown ? CONFIG.COUNTDOWN_TIMER_START : null, fresh: true });
      this.board[r][c] = makeBomb();
      const total = CONFIG.BLOCKER_BOX_BOMBS_MIN
                  + Math.floor(this.rng() * (CONFIG.BLOCKER_BOX_BOMBS_MAX - CONFIG.BLOCKER_BOX_BOMBS_MIN + 1));
      let placed = 1, guard = 0;
      while (placed < total && guard++ < 150) { // extras land on random plain tiles anywhere
        const rr = Math.floor(this.rng() * this.rows), cc = Math.floor(this.rng() * this.cols);
        const o = this.board[rr][cc];
        if (!o || o.special || this.protectedTile(o)) continue;
        this.board[rr][cc] = makeBomb();
        this.addFx(rr, cc, '💣', 'emoji');
        placed++;
      }
      this.segBlockers.box++;
      this.callout(`📦 Box cracked — ${placed} bombs inside!`);
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
// Any icon: slot art (em-sized, flows like a glyph) or its emoji fallback.
function ic(slot, fallback, cls) { return slotImg(slot, cls || 'pu-img') || fallback; }
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

// Parent of an upgrade pick, derived from its gate flag — data-driven, no
// per-card hardcoding (UI pass, Omri 2026-09-01).
function parentOf(def) {
  return def.requiresBoost ? 'boost' : def.requiresSquare ? 'square' : def.requiresChomper ? 'chomper' : null;
}

function buildChips(G) {
  const chips = [], byKey = new Map();
  for (const p of G.run.picks) {
    const def = POWERUPS[p.id];
    const k = p.id + (p.color !== undefined ? ':' + p.color : '');
    if (byKey.has(k)) byKey.get(k).count++;
    else { const ch = { key: k, def, pick: p, count: 1 }; byKey.set(k, ch); chips.push(ch); }
  }
  // upgrades sit directly after their parent (stable otherwise)
  const grouped = [];
  for (const ch of chips) {
    if (parentOf(ch.def)) continue;
    grouped.push(ch);
    for (const up of chips) if (parentOf(up.def) === ch.def.id) grouped.push(up);
  }
  for (const ch of chips) if (parentOf(ch.def) && !grouped.includes(ch)) grouped.push(ch); // orphans (cheat picks)
  return grouped;
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

/* ============================ BOARD HUB UI =================================
   The board-game meta screen — rendered whenever no run is active (phase
   'menu'). All meta state lives in META (persisted); React state here is
   purely presentational (die face, popups, hop animation, toasts). */

// Position of space i on the loop, in % of the square board container —
// clockwise from Home at 12 o'clock.
function spaceXY(i) {
  const a = (i / CONFIG.BOARD_SPACES) * Math.PI * 2 - Math.PI / 2;
  return { x: 50 + 43.5 * Math.cos(a), y: 50 + 43.5 * Math.sin(a) };
}

function rollMystery() {
  const r = Math.random();
  if (r < 0.45) return { kind: 'coins', coins: randInt(CONFIG.MYSTERY_COINS_MIN, CONFIG.MYSTERY_COINS_MAX) };
  if (r < 0.80) { const ids = Object.keys(CONSUMABLES); return { kind: 'consumable', item: ids[Math.floor(Math.random() * ids.length)] }; }
  return { kind: 'dice', dice: 1 };
}

// Active run modifiers as small icon chips (board preview + in-run HUD).
function RunModChips({ mods, label }) {
  if (!mods || !mods.length) return null;
  const byId = new Map();
  for (const m of mods) {
    if (!RUN_MODIFIERS[m.id]) continue;
    byId.set(m.id, (byId.get(m.id) || 0) + 1);
  }
  return h`<div className="runmods">
    ${label ? h`<span className="runmods-label">${label}</span>` : null}
    ${[...byId].map(([id, count]) => {
      const d = RUN_MODIFIERS[id];
      return h`<span key=${id} className=${'chip modchip' + (d.negative ? ' negative' : '')} title=${`${d.name} — ${d.desc}`}>
        ${ic('runmod.' + id, d.icon)}${count > 1 ? h`<b>×${count}</b>` : null}
      </span>`;
    })}
  </div>`;
}

function ConsumableRow() {
  const inv = META.state.consumables;
  return h`<span className="binv">
    ${Object.values(CONSUMABLES).map(c => h`<span key=${c.id} className=${'binv-item' + (inv[c.id] ? '' : ' none')} title=${c.name}>
      ${ic('consumable.' + c.id, c.icon)}<b>${inv[c.id] || 0}</b>
    </span>`)}
  </span>`;
}

/* ----- Mini-game: coin flip — one tap, heads 30 / tails 15 */
function CoinFlipGame({ onDone }) {
  const [state, setState] = React.useState('ready'); // ready | flipping | done
  const [heads, setHeads] = React.useState(false);
  const flip = () => {
    if (state !== 'ready') return;
    const isHeads = Math.random() < 0.5;
    setHeads(isHeads);
    setState('flipping');
    setTimeout(() => {
      META.addCoins(isHeads ? CONFIG.COIN_FLIP_HEADS : CONFIG.COIN_FLIP_TAILS);
      setState('done');
    }, 950);
  };
  const coins = heads ? CONFIG.COIN_FLIP_HEADS : CONFIG.COIN_FLIP_TAILS;
  return h`<div className="minigame-body">
    <div className=${'flipcoin' + (state === 'flipping' ? ' flipping' : '') + (state === 'done' ? (heads ? ' heads' : ' tails') : '')}
      onClick=${flip}>${state === 'done' ? (heads ? '👑' : '🌙') : '🪙'}</div>
    ${state === 'ready' ? h`<button className="primary" onClick=${flip}>Flip!</button>` : null}
    ${state === 'done' ? h`<div className="mg-result">${heads ? 'Heads' : 'Tails'}! <b className="gold">+${coins} 🪙</b></div>` : null}
    ${state === 'done' ? h`<button className="primary" onClick=${onDone}>Collect</button>` : null}
  </div>`;
}

/* ----- Mini-game: scratch card — 3 tiles; 3 same = jackpot, 2 same = medium,
   no match still pays the small consolation. */
const SCRATCH_SYMBOLS = ['🍒', '💎', '⭐'];
function ScratchGame({ onDone }) {
  const [tiles] = React.useState(() => Array.from({ length: 3 }, () => SCRATCH_SYMBOLS[Math.floor(Math.random() * SCRATCH_SYMBOLS.length)]));
  const [shown, setShown] = React.useState([false, false, false]);
  const paid = React.useRef(false);
  const done = shown.every(Boolean);
  let payout = CONFIG.SCRATCH_CARD_SMALL, tier = 'no match';
  const counts = {};
  for (const t of tiles) counts[t] = (counts[t] || 0) + 1;
  const best = Math.max(...Object.values(counts));
  if (best === 3) { payout = CONFIG.SCRATCH_CARD_JACKPOT; tier = 'JACKPOT'; }
  else if (best === 2) { payout = CONFIG.SCRATCH_CARD_MEDIUM; tier = 'pair'; }
  if (done && !paid.current) { paid.current = true; META.addCoins(payout); }
  const reveal = i => setShown(s => s.map((v, j) => (j === i ? true : v)));
  return h`<div className="minigame-body">
    <div className="scratch-row">
      ${tiles.map((t, i) => h`<button key=${i} className=${'scratch-tile' + (shown[i] ? ' shown' : '')}
        onClick=${() => reveal(i)}>${shown[i] ? t : '▚'}</button>`)}
    </div>
    ${done
      ? h`<div className="mg-result">${tier === 'JACKPOT' ? '🎉 JACKPOT! ' : tier === 'pair' ? 'A pair! ' : 'No match — '}<b className="gold">+${payout} 🪙</b></div>
          <button className="primary" onClick=${onDone}>Collect</button>`
      : h`<div className="mg-hint">Scratch all three tiles</div>`}
  </div>`;
}

/* ----- Mystery box — tap to open, then the reward pops out */
function MysteryBox({ reward, onDone }) {
  const [open, setOpen] = React.useState(false);
  const applied = React.useRef(false);
  const doOpen = () => {
    if (open) return;
    if (!applied.current) {
      applied.current = true;
      if (reward.kind === 'coins') META.addCoins(reward.coins);
      else if (reward.kind === 'consumable') META.addConsumable(reward.item);
      else META.addDice(reward.dice);
    }
    setOpen(true);
  };
  return h`<div className="minigame-body">
    ${!open
      ? h`<div className="mystery-box" onClick=${doOpen}>${ic('mspace.mystery', '🎁', 'mg-img')}</div><button className="primary" onClick=${doOpen}>Open it</button>`
      : h`<div className="mystery-reveal">
            ${reward.kind === 'coins' ? h`<div className="mg-bigicon">${ic('icon.coin', '🪙', 'mg-img')}</div><div className="mg-result"><b className="gold">+${reward.coins} coins</b></div>`
            : reward.kind === 'consumable' ? h`<div className="mg-bigicon">${ic('consumable.' + reward.item, CONSUMABLES[reward.item].icon, 'mg-img')}</div><div className="mg-result"><b>${CONSUMABLES[reward.item].name}</b> added to your kit</div>`
            : h`<div className="mg-bigicon">${ic('icon.dice', '🎲', 'mg-img')}</div><div className="mg-result"><b className="gold">+${reward.dice} die</b></div>`}
          </div>
          <button className="primary" onClick=${onDone}>Collect</button>`}
  </div>`;
}

/* ----- The landing popup — one overlay, body switches on space type */
function SpaceRevealPopup({ ui, world, onClose }) {
  const t = SPACE_TYPES[ui.type] || SPACE_TYPES.empty;
  const body = (() => {
    switch (ui.type) {
      case 'coin': return h`<div className="mg-bigicon">${ic('icon.coin', '🪙', 'mg-img')}</div><div className="mg-result"><b className="gold">+${ui.coins} coins</b></div><button className="primary" onClick=${onClose}>Collect</button>`;
      case 'consumable': return h`<div className="mg-bigicon">${ic('consumable.' + ui.item, CONSUMABLES[ui.item].icon, 'mg-img')}</div><div className="mg-result"><b>${CONSUMABLES[ui.item].name}</b> added to your kit</div><button className="primary" onClick=${onClose}>Take it</button>`;
      case 'modifier': {
        const d = RUN_MODIFIERS[ui.mod];
        return h`<div className="mg-bigicon">${ic('runmod.' + ui.mod, d.icon, 'mg-img')}</div><div className="mg-title">${d.name}</div><p className="mg-desc">${d.desc}</p><p className="mg-sub">Active for your next run only</p><button className="primary" onClick=${onClose}>Nice</button>`;
      }
      case 'mystery': return h`<${MysteryBox} reward=${ui.reward} onDone=${onClose} />`;
      case 'minigame_flip': return h`<${CoinFlipGame} onDone=${onClose} />`;
      case 'minigame_scratch': return h`<${ScratchGame} onDone=${onClose} />`;
      case 'metaoffer': { // v11: auto-applied on landing — a net positive needs no decline
        const offer = META_POWERUPS[ui.offer];
        return h`<div className="mg-bigicon">${ic('metaoffer.' + ui.offer, offer.icon, 'mg-img')}</div><div className="mg-title">${offer.name}</div><div className="mg-result gold">${offer.desc}</div><button className="primary" onClick=${onClose}>Collect</button>`;
      }
      case 'landmark': return h`<div className="mg-bigicon">${ic('mspace.landmark', '🏠', 'mg-img')}</div><div className="mg-result">Welcome home — lap complete!</div><p className="mg-desc">+${CONFIG.LANDMARK_MOVE_BONUS} starting move banked for your next run.</p><button className="primary" onClick=${onClose}>Onward</button>`;
      default: return h`<button className="primary" onClick=${onClose}>OK</button>`;
    }
  })();
  return h`<div className="overlay"><div className=${'panel spacepanel sp-' + t.cls}>
    <div className="sp-label">${t.label}</div>
    ${body}
  </div></div>`;
}

/* ----- Boss offer / pre-run announcement — landing on the boss space */
function BossOfferPanel({ world, onFight, onFlee }) {
  return h`<div className="overlay"><div className="panel spacepanel sp-boss">
    <div className="sp-label">BOSS</div>
    <div className="mg-bigicon boss-icon">${ic(`boss.${world.id}`, world.boss.icon, 'mg-img')}</div>
    <div className="mg-title">${world.boss.name}</div>
    <p className="mg-desc">World ${world.id} boss run — reach the final flag to clear it and advance to the next world.</p>
    <div className="boss-mods">
      ${world.boss.modifiers.map(id => {
        const d = RUN_MODIFIERS[id];
        return h`<div key=${id} className="boss-mod">${d.icon} <b>${d.name}</b> — ${d.desc.replace('BOSS: ', '')}</div>`;
      })}
    </div>
    <div className="mg-buttons">
      <button className="primary danger" onClick=${onFight}>⚔️ Fight!</button>
      <button onClick=${onFlee}>Not yet</button>
    </div>
  </div></div>`;
}

/* ----- The loop itself: 20 spaces + token, positioned around a circle.
   hopMs scales the token's glide + bounce with the ×1/×2/×3 speed toggle. */
function BoardLoop({ pos, hopKey, moving, hopMs }) {
  const world = META.world();
  const spaces = world.spaces.map((type, i) => {
    const t = SPACE_TYPES[type];
    const { x, y } = spaceXY(i);
    return h`<div key=${i} style=${{ left: x + '%', top: y + '%' }}
      className=${'bspace ' + t.cls + (i === pos ? ' here' : '')}
      title=${t.label}>
      <div className="bspace-in">${type === 'empty' ? ic(`world.${world.id}.icon`, world.icon, 'mspace-img') : ic('mspace.' + type, t.icon, 'mspace-img')}</div>
    </div>`;
  });
  const { x, y } = spaceXY(pos);
  const ease = 'cubic-bezier(.3,.7,.35,1.1)';
  return h`<div className="bloop">
    <div className="bring"></div>
    ${spaces}
    <div className=${'btoken' + (moving ? ' moving' : '')}
      style=${{ left: x + '%', top: y + '%', transition: `left ${hopMs}ms ${ease}, top ${hopMs}ms ${ease}` }}>
      <div key=${hopKey} className="btoken-in" style=${{ animationDuration: hopMs + 'ms' }}>${ic('token', '🧗', 'token-img')}</div>
    </div>
  </div>`;
}

/* ----- Top bar — persistent across both camera states (M1): world · wallet */
function TopBar() {
  const S = META.state, world = META.world();
  return h`<div className="topbar"><div className="bhead">
    <div className="bworld">${ic(`world.${S.world}.icon`, world.icon)} <b>${world.name}</b><span className="bworld-n">World ${S.world}/${WORLDS.length}</span></div>
    <div className="bwallet"><span className="bcoins">${ic('icon.coin', '🪙')} ${S.coins}</span><${ConsumableRow} /></div>
  </div></div>`;
}

/* ----- Dummy board — what peeks under the hub before a run exists (M1).
   Decorative only (never the run board, so the one-render rule holds). */
function DummyBoard() {
  const cell = useCellSize(CONFIG.BOARD_COLS, CONFIG.BOARD_ROWS);
  const [colours] = React.useState(() => Array.from({ length: CONFIG.BOARD_ROWS * CONFIG.BOARD_COLS }, () => Math.floor(Math.random() * 5)));
  const tiles = colours.map((col, i) => {
    const r = Math.floor(i / CONFIG.BOARD_COLS), c = i % CONFIG.BOARD_COLS;
    const art = slotImg('piece.' + SKIN.PIECE_SLOTS[col], 'piece-img');
    return h`<div key=${i} className="tile" style=${{ transform: `translate(${c * cell}px,${r * cell}px)`, width: cell + 'px', height: cell + 'px' }}>
      <div className=${'tin bg' + col + (art ? ' skinned' : '')}>${art}</div></div>`;
  });
  return h`<div className="board-stack dummy"><div className="board-wrap"
    style=${SKIN.has('board.frame') ? { borderImage: `url(${SKIN.url('board.frame')}) 96 fill / 20px stretch`, borderWidth: '20px', borderStyle: 'solid', borderColor: 'transparent', background: 'none', boxShadow: 'none', padding: '6px' } : null}>
    <div className="board" style=${{ width: CONFIG.BOARD_COLS * cell + 'px', height: CONFIG.BOARD_ROWS * cell + 'px' }}>${tiles}</div>
  </div></div>`;
}

/* ----- Board hub screen */
function BoardScreen({ G }) {
  const S = META.state;
  const world = META.world();
  const [ui, setUi] = React.useState({ mode: 'idle' }); // idle|rolling|moving|reveal|bossoffer
  const [face, setFace] = React.useState(CONFIG.DIE_SIDES);
  const [hopKey, setHopKey] = React.useState(0);
  const [notes, setNotes] = React.useState([]);
  const [seed, setSeed] = React.useState('');
  const noteId = React.useRef(1);
  const timers = React.useRef([]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));
  const busy = ui.mode !== 'idle';
  // ×1/×2/×3 board animation speed (dice tumble + token hops) — persisted,
  // read live so mid-move toggles apply to the remaining steps.
  const speed = () => S.boardSpeed || 1;
  const spd = ms => Math.max(40, Math.round(ms / speed()));
  const cycleSpeed = () => {
    S.boardSpeed = speed() >= 3 ? 1 : speed() + 1;
    META.save();
    G.render();
  };

  const note = (text, cls = '') => {
    const id = noteId.current++;
    setNotes(n => [...n, { id, text, cls }]);
    later(() => setNotes(n => n.filter(x => x.id !== id)), 2600);
  };

  const startRun = boss => {
    const s = parseInt(seed, 10);
    G.newRun(Number.isFinite(s) && s > 0 ? s : 1 + Math.floor(Math.random() * 999999999), { boss });
  };

  const roll = () => {
    if (busy || S.dice <= 0) return;
    META.addDice(-1); // spend the die up front
    setUi({ mode: 'rolling' });
    const result = 1 + Math.floor(Math.random() * CONFIG.DIE_SIDES);
    let ticks = 0;
    const spin = setInterval(() => {
      setFace(1 + Math.floor(Math.random() * CONFIG.DIE_SIDES));
      if (++ticks >= 6) {
        clearInterval(spin);
        setFace(result);
        later(() => move(result), spd(240));
      }
    }, spd(55));
    timers.current.push(spin); // clearTimeout on an interval id is a no-op-safe clear in browsers
  };

  const move = n => {
    setUi({ mode: 'moving' });
    let step = 0;
    const hop = () => {
      step++;
      const wasUnlocked = META.bossUnlocked();
      S.pos = (S.pos + 1) % CONFIG.BOARD_SPACES;
      if (S.pos === 0) {
        META.onLap();
        note(`🏁 Lap ${S.laps} complete! +${CONFIG.LANDMARK_MOVE_BONUS} starting move next run`);
        if (!wasUnlocked && META.bossUnlocked()) later(() => note(`👹 ${world.boss.name} has appeared on the board!`, 'danger'), 900);
      }
      META.save();
      setHopKey(k => k + 1);
      G.render();
      if (step < n) later(hop, spd(270));
      else later(() => landOn(S.pos), spd(380));
    };
    later(hop, spd(200));
  };

  // Land on a space: instant rewards are applied HERE, exactly once — the
  // popup only displays them. Interactive spaces (mystery, mini-games)
  // apply inside their component when the player acts.
  const landOn = idx => {
    const type = world.spaces[idx];
    switch (type) {
      case 'coin': {
        const n = randInt(CONFIG.BOARD_COIN_REWARD_MIN, CONFIG.BOARD_COIN_REWARD_MAX);
        META.addCoins(n);
        setUi({ mode: 'reveal', type, coins: n });
        break;
      }
      case 'consumable': {
        const ids = Object.keys(CONSUMABLES);
        const item = ids[Math.floor(Math.random() * ids.length)];
        META.addConsumable(item);
        setUi({ mode: 'reveal', type, item });
        break;
      }
      case 'modifier': {
        const id = world.modifierPool[Math.floor(Math.random() * world.modifierPool.length)];
        META.addModifier(id);
        setUi({ mode: 'reveal', type, mod: id });
        break;
      }
      case 'mystery': setUi({ mode: 'reveal', type, reward: rollMystery() }); break;
      case 'metaoffer': { // v11: net positive — applied on the spot, no accept/decline
        const offer = world.metaOffers[Math.floor(Math.random() * world.metaOffers.length)];
        META_POWERUPS[offer].apply();
        setUi({ mode: 'reveal', type, offer });
        break;
      }
      case 'minigame_flip':
      case 'minigame_scratch':
      case 'landmark': setUi({ mode: 'reveal', type }); break;
      default: setUi({ mode: 'idle' }); // empty space — dead beat, nothing happens (v11: flavour cut)
    }
  };

  const close = () => { setUi({ mode: 'idle' }); G.render(); };
  const bossReady = META.bossUnlocked();

  return h`<div className="screen board-screen">
    ${META.campaignDone() ? h`<div className="bdone">👑 All three worlds cleared — the endless climb is yours!</div>` : null}
    <${RunModChips} mods=${S.modifiers} label="Next run:" />
    <div className="bboard">
      <button className="bspeed" title="Board animation speed" onClick=${cycleSpeed}>⏩ ×${speed()}</button>
      <${BoardLoop} pos=${S.pos} hopKey=${hopKey} moving=${ui.mode === 'moving'} hopMs=${spd(240)} />
      <div className="bhub">
        <div className="bdice-count">${ic('icon.dice', '🎲')} <b>${S.dice}</b></div>
        <div className=${'bdie' + (ui.mode === 'rolling' ? ' rolling' : '') + (SKIN.has('die') ? ' skinned' : '')}
          style=${{ ...(ui.mode === 'rolling' ? { animationDuration: spd(280) + 'ms' } : null), ...(SKIN.has('die') ? { backgroundImage: `url(${SKIN.url('die')})` } : null) }}>${face}</div>
        <button className="primary broll" disabled=${busy || S.dice <= 0} onClick=${roll}>
          ${S.dice > 0 ? h`Roll ${ic('icon.dice', '🎲')}` : 'No dice'}
        </button>
        <button className="bbuy" disabled=${busy || S.coins < CONFIG.DICE_PRICE_COINS}
          onClick=${() => { if (META.buyDie()) { note('🎲 +1 die!'); G.render(); } }}>
          +1 ${ic('icon.dice', '🎲')} for ${CONFIG.DICE_PRICE_COINS} ${ic('icon.coin', '🪙')}
        </button>
        <div className="blaps">${ic('icon.lap', '🏁')} Lap ${S.laps}</div>
        <div className=${'bboss-progress' + (bossReady ? ' ready' : '')}>
          ${ic(`boss.${S.world}`, '👹')} ${META.state.bossDefeated.includes(S.world) ? 'beaten ✓' : bossReady ? 'READY' : `${S.worldLaps}/${world.lapsForBoss} laps`}
        </div>
      </div>
      <div className="bnotes">${notes.map(nt => h`<div key=${nt.id} className=${'callout ' + nt.cls}>${nt.text}</div>`)}</div>
    </div>
    ${S.dice <= 0 && ui.mode === 'idle' ? h`<p className="bhint-dice">Finish runs to earn dice — win for ${CONFIG.DICE_MIN_ON_WIN} + 1 per leftover move, or cross checkpoint ${CONFIG.PARTIAL_CLEAR_CHECKPOINT} for ${CONFIG.DICE_ON_PARTIAL_CLEAR}.</p>` : null}
    ${bossReady
      ? h`<button className="primary danger bstart" disabled=${busy} onClick=${() => setUi({ mode: 'bossoffer' })}>⚔️ Fight ${world.boss.name}</button>`
      : h`<button className="primary bstart" disabled=${busy} onClick=${() => startRun(false)}>Play run</button>`}
    <details className="tester-tools">
      <summary>🧪 Tester tools</summary>
      <div className="menu-box">
        <label>Seed <input value=${seed} placeholder="random" onChange=${e => setSeed(e.target.value)} inputMode="numeric" /></label>
        <${Toggle} G=${G} />
        <${ColourToggle} G=${G} />
        <div className="tt-worlds">
          <span className="tt-label">Skip to world</span>
          ${WORLDS.map(w => h`<button key=${w.id}
            className=${'tt-world' + (S.world === w.id ? ' active' : '')}
            disabled=${busy || S.world === w.id}
            title=${`${w.name} — resets laps + board position, unlocks batch ${w.id}`}
            onClick=${() => {
              S.world = w.id; S.worldLaps = 0; S.pos = 0; META.save();
              note(`🧪 Skipped to world ${w.id} — ${w.name}`);
              G.render();
            }}>${w.icon} ${w.id}</button>`)}
        </div>
        <button className="tt-reset" onClick=${() => {
          if (!confirm('Reset ALL board progress? Laps, dice, coins, items, world — everything starts fresh.')) return;
          try { localStorage.removeItem(META_KEY); } catch (e) {}
          location.reload();
        }}>🗑️ Reset progress (fresh save)</button>
      </div>

    </details>
    ${ui.mode === 'reveal' ? h`<${SpaceRevealPopup} ui=${ui} world=${world} onClose=${close} />` : null}
    ${ui.mode === 'bossoffer' ? h`<${BossOfferPanel} world=${world} onFight=${() => startRun(true)} onFlee=${close} />` : null}
  </div>`;
}

// Player-facing menu is just logo + CTA; seed/toggles/stats live in a
// collapsed DEV drawer (CD, 2026-08-31 — match-quest dev-drawer pattern).
function MenuScreen({ G }) {
  const [seed, setSeed] = React.useState(() => String(1 + Math.floor(Math.random() * 999999999)));
  const [dev, setDev] = React.useState(false);
  return h`<div className="screen menu">
    ${SKIN.has('logo')
      ? h`<img className="menu-logo" src=${SKIN.url('logo')} alt="Mage Match" />`
      : h`<h1>🏔️ Mage Match</h1>`}
    <button className="primary menu-start" onClick=${() => G.newRun(parseInt(seed, 10) || 1)}>Play level</button>
    <${BlockerToggles} G=${G} />
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
// (MenuScreen is kept for main-parity only — the board hub is the menu here.)

// v20: pre-run per-blocker toggles (visible on the menu, not the 🧪 panel).
function BlockerToggles({ G }) {
  const [, bump] = React.useReducer(x => x + 1, 0);
  const B = [['box', '📦', 'Boxes'], ['water', '💧', 'Water'], ['safe', '🔒', 'Safes']];
  return h`<div className="blocker-toggles">
    <span className="blocker-toggles-label">Blockers</span>
    ${B.map(([k, icon, name]) => h`<button key=${k}
      className=${'toggle blocker-toggle' + (G.opts.blockers[k] ? ' on' : '')}
      onClick=${() => { G.opts.blockers[k] = !G.opts.blockers[k]; bump(); G.render(); }}>
      ${icon} ${name} <b>${G.opts.blockers[k] ? 'ON' : 'off'}</b>
    </button>`)}
  </div>`;
}

function ColorDot({ color }) {
  return h`<span className=${'dot bg' + color}></span>`;
}

// Shared draft card (CD, 2026-08-31): big icon on the LEFT, name (title font)
// + description to the right, cluster tag as a ribbon off the right edge.
/* CD copy pass (2026-09-01): ultra-short card titles — the pick's NAME shrinks
   to a small kicker and this line is the big text. Tone: telegraphic, numbers
   as +N. Full descriptions stay on the power-bar chip tooltips. A pick missing
   here falls back to its long desc (visible = it needs a line adding). */
const SHORT_DESC = {
  boost: p => `${COLOR_NAMES[p.color]} tile +1`,
  flood: () => 'Matches spread the colour',
  spawner: () => 'Boosted matches spawn specials',
  fillup: () => 'Boosted tiles charge a multiplier',
  sweep: () => 'Vertical matches clear the colour',
  converter: () => 'Matches paint one tile to a Boosted color',
  spawnweight: () => 'More tiles drop more often',
  purge: () => '4+ matches wipe the colour',
  snowpaint: () => 'Boosted matches charge the snowball',
  bombchance: () => `+${Math.round(CONFIG.BOMB_CHANCE_PER_PICK * 100)}% bomb spawns`,
  countdown: () => 'Specials auto-explode',
  blast: () => 'Bigger explosions',
  specialscore: () => 'Specials +1',
  rowclear: () => 'Horizontal match clears the row',
  colclear: () => 'Vertical match clears the column',
  matryoshka: () => 'Specials leave smaller specials',
  aftershock: () => 'Explosions scorch nearby tiles',
  fusionmove: () => 'Specials Merge grants extra move',
  lava: () => 'Bottom row melts each move',
  snowcrush: () => 'Specials charge the snowball',
  expandrow: () => 'Board +1 row',
  expandcol: () => 'Board +1 column',
  xtramove: () => 'Spawn Xtra move tiles',
  square: () => 'Square match',
  squarebomb: () => 'Squares spawn bombs',
  squarescore: () => `Squares +${CONFIG.SQUARE_BONUS_POINTS}`,
  lifesaver: () => `Survive once, +${CONFIG.LIFESAVER_BONUS_MOVES} moves`,
  momentum: () => 'Big matches charge an extra move',
  chomper: () => 'A Chomper eats on the Board',
  twinchomper: () => 'A second Chomper joins',
  doublebite: () => 'Chomper eats twice',
  gourmet: () => 'Chomper meals ×2',
  spicytrail: () => "Chomper's trail burns",
  bombtrail: () => 'Chomper leaves bombs',
  buffet: () => 'More Chomper snacks',
  conveyor: () => 'Board edges rotate',
  diagswap: () => 'Swap diagonally',
  pinata: () => 'Spawn pinata tiles who grant extra points',
  tripletile: () => `Match the mark, move ×${CONFIG.TRIPLE_TILE_MULT}`,
  chests: () => 'Chests who reach the bottom give rewards',
};
POWERUPS.square.name = '2×2'; // player-facing rename (CD, 2026-09-01)

function DraftCard({ G, o, i }) {
  const def = POWERUPS[o.id];
  // merged: Omri's card identity (cluster tint, parent line, tier badges)
  // under the CD copy layout (name kicker + short title)
  const short = SHORT_DESC[o.id] ? SHORT_DESC[o.id](o) : def.desc(o);
  const parent = parentOf(def); // data-driven from the requires* gate
  return h`<button className=${'card cl-' + def.cluster + (def.tier === 3 ? ' legendary-card' : '')} onClick=${() => G.pickOffer(i)}>
    <div className="card-icon">${puIcon(o.id)}${o.color !== undefined ? h`<${ColorDot} color=${o.color} />` : null}</div>
    <div className="card-main">
      <div className="card-kicker">${def.name}${o.color !== undefined ? ` — ${COLOR_NAMES[o.color]}` : ''}</div>
      <div className="card-name">${short}</div>
      ${parent ? h`<div className="card-parent"><span className="card-parent-ic">${puIcon(parent)}</span> ↑ ${POWERUPS[parent].name}</div>` : null}
    </div>
    <div className=${'card-tag ' + def.cluster}>${def.cluster}</div>
    ${def.tier === 2 ? h`<div className="card-tier t2" title="Deeper unlock">★</div>` : null}
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
    if (G.armed) { G.useConsumable(G.armed, cl); return; } // consumable targeting eats the tap
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
    bg.push(h`<div key=${'b' + r + '_' + c}
      className=${'bgcell' + (((r + c) % 2) ? ' alt' : '') + (SKIN.has(cellSlot) ? ' img' : '') + (G.marks.has(cellKey) ? ' mark' : '') + (G.pinatas.has(cellKey) ? ' pin' : '') + (G.triples.has(cellKey) ? ' tri' : '') + (G.foodCells.has(cellKey) ? ' foodc' : '')}
      style=${{ transform: `translate(${c * cell}px,${r * cell}px)`, width: cell + 'px', height: cell + 'px',
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

// In-run consumable buttons — hammer/bomb arm a board tap, shuffle fires
// immediately. Inventory is the persistent META stash (spent for good).
function ConsumableBar({ G }) {
  const inv = META.state.consumables;
  if (!Object.values(inv).some(n => n > 0)) return null;
  const arm = kind => {
    if (G.phase !== 'level' || G.busy || !(inv[kind] > 0)) return;
    if (kind === 'shuffle') { G.useConsumable('shuffle'); return; }
    G.armed = G.armed === kind ? null : kind; // toggle = cancel
    G.render();
  };
  return h`<div className="consbar">
    ${G.armed ? h`<div className="cons-hint">${G.armed === 'hammer' ? '🔨 Tap a tile to smash it' : '🧨 Tap a tile to blast the area'} — tap again to cancel</div>` : null}
    <div className="chip-row">
      ${Object.values(CONSUMABLES).map(c => h`<button key=${c.id}
        className=${'chip consbtn' + (G.armed === c.id ? ' active' : '')}
        disabled=${!(inv[c.id] > 0) || G.busy}
        title=${c.name}
        onClick=${() => arm(c.id)}>
        ${c.icon}<b>${inv[c.id] || 0}</b>
      </button>`)}
    </div>
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
        ${G.bossRun ? h`<span className="hud-boss" title="Boss run">👹</span>` : null}
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
      <div className=${'board-wrap' + (G.phase === 'level' && G.movesLeft <= 3 && G.movesLeft >= 1 ? ' danger d' + G.movesLeft : '') + (G.armed ? ' aiming' : '')}
        style=${SKIN.has('board.frame') ? { borderImage: `url(${SKIN.url('board.frame')}) 96 fill / 20px stretch`, borderWidth: '20px', borderStyle: 'solid', borderColor: 'transparent', background: 'none', boxShadow: 'none', padding: '6px' } : null}><${Board} G=${G} /></div>
      <${ConsumableBar} G=${G} />
      <${RunModChips} mods=${G.runMods} />
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
        <h2>Goal ${cp.n} cleared!${cp.crossed > 1 ? ` (×${cp.crossed} in one move!)` : ''}</h2>
        <p className="carryline"><b>${cp.kept}</b> moves kept + <b>${cp.moves}</b> bonus = <b>${cp.total}</b>/${CONFIG.MAX_MOVES} 👟</p>
        <p className="carrysub">Leftover moves always carry over.</p>
        ${cp.final ? h`<p>Final goal cleared — the endless chase begins 🔥</p>` : null}
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
      <div className="draft-sub">${G.bossRun ? '👹 Boss run — ' : ''}${G.run.checkpointIdx > 0 ? `Goal ${G.run.checkpointIdx}` : 'The run begins'}</div>
      <div className="draft-title">Pick a Spell</div>
      <${RunModChips} mods=${G.runMods} label=${G.runMods.length && G.run.checkpointIdx === 0 ? 'This run:' : null} />
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
  const rw = G.runReward;
  return h`<div className="screen end">
    <div className="end-sub">${win ? (G.bossRun ? '⚔️ Boss cleared!' : '🏆 Summit reached!') : '💀 Out of moves'}</div>
    <h1>Cleared ${G.run.checkpointIdx} / ${G.checkpoints().length} ${G.checkpoints().length === 1 ? 'goal' : 'goals'}!</h1>
    ${rw && rw.bossCleared ? h`<div className="end-boss">
      ${rw.worldAdvanced
        ? `👹 ${'→'} 🌍 World ${META.state.world} unlocked — new power-ups join the draft pool!`
        : '👑 Final boss down — every world cleared!'}
    </div>` : null}
    ${G.bossRun && !win ? h`<div className="end-boss lost">👹 The boss stands — challenge it again from the board.</div>` : null}
    <div className="end-stats">
      <div><b>${G.score}</b> final score</div>
      ${win ? h`<div className="end-spare">👟 <b>${Math.max(0, G.movesLeft)}</b> ${G.movesLeft === 1 ? 'move' : 'moves'} to spare</div>` : null}
      <div className=${'end-dice' + (rw && rw.dice > 0 ? ' won' : '')}>
        ${rw && rw.dice > 0 ? h`🎲 <b>+${rw.dice}</b> ${rw.dice === 1 ? 'die' : 'dice'} earned` : '🎲 no dice this time'}
        <span className="end-dice-total"> — ${META.state.dice} banked</span>
      </div>
      <div className="seedline">seed ${G.seed}</div>
    </div>
    ${chips.length ? h`<div className="build">
      <div className="build-title">Final build</div>
      <div className="chip-row">${chips.map(ch => h`<span className="chip" key=${ch.key} title=${ch.def.desc(ch.pick)}>
        ${puIcon(ch.def.id)}${ch.pick.color !== undefined ? h`<${ColorDot} color=${ch.pick.color} />` : null}${ch.count > 1 ? h`<b>×${ch.count}</b>` : null}
      </span>`)}</div>
    </div>` : null}
    <div className="end-buttons">
      <button className="primary" onClick=${() => G.backToBoard()}>🎲 Back to board</button>
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
      game: G, CONFIG, POWERUPS, META, WORLDS,
      telemetry: { all: telemetryAll, summary: telemetrySummary, clear: telemetryClear },
      cheat: {
        // jump the score to the next checkpoint (base game's cheat.win analogue)
        cross() { const cps = G.checkpoints(); if (G.run.checkpointIdx < cps.length) { G.score = cps[G.run.checkpointIdx]; G.checkLevelEnd(); G.render(); } },
        win() { this.cross(); },
        addScore(n) { G.score += n; G.checkLevelEnd(); G.render(); },
        setMoves(n) { G.movesLeft = n; G.render(); },
        pick(id, color) { G.run.picks.push(color !== undefined ? { id, color } : { id }); G.computeMods(); G.render(); },
        // --- board meta cheats ---
        dice(n) { META.state.dice = Math.max(0, n); META.save(); G.render(); },
        coins(n) { META.state.coins = n; META.save(); G.render(); },
        lap(n = 1) { for (let i = 0; i < n; i++) META.onLap(); G.render(); },
        world(w) { META.state.world = Math.max(1, Math.min(WORLDS.length, w)); META.state.worldLaps = 0; META.state.pos = 0; META.save(); G.render(); },
        resetMeta() { try { localStorage.removeItem(META_KEY); } catch (e) {} location.reload(); },
        // queue a power-up into the next draft's first slot (🧪 panel parity)
        forceOffer(id) { (G.forcedOffers = G.forcedOffers || []).push(id); if (G.phase === 'draft') { G.offers = G.makeOffers(); } G.render(); },
      },
    };
  }
  const G = ref.current;
  /* M1 — one vertical surface (match-quest contract): board zone + seam +
     level zone are ALWAYS rendered; the camera pans between them. Both the
     hub and the run live in the same world. `arrived` gates the level chrome
     (HUD, chips, overlays) so they fade in after the pan lands. */
  const inRun = G.phase !== 'menu';
  const [arrived, setArrived] = React.useState(false);
  React.useEffect(() => {
    if (!inRun) { setArrived(false); return; }
    const t = setTimeout(() => setArrived(true), 980);
    return () => clearTimeout(t);
  }, [inRun]);
  // peek shift: park the level content so the board's top sits at the zone
  // top while in the hub (the "one board, slid into place" hand-off)
  const zoneRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const z = zoneRef.current; if (!z) return;
    const bw = z.querySelector('.board-wrap');
    if (bw) z.style.setProperty('--peek-shift', Math.max(0, bw.getBoundingClientRect().top - z.getBoundingClientRect().top + (parseFloat(getComputedStyle(z).getPropertyValue('--peek-shift')) || 0) * (inRun ? 0 : 1)) + 'px');
  });
  const ended = G.phase === 'win' || G.phase === 'loss';
  return h`<div className=${'phone' + (inRun ? ' cam-level' : '') + (arrived ? ' arrived' : '')}>
    ${SKIN.has('bg.main')
      ? h`<img className="bg-main" src=${SKIN.url('bg.main')} alt="" />`
      : h`<div className="bg-main bg-main-placeholder"></div>`}
    <${TopBar} />
    <div className="viewport"><div className="surface">
      <div className="zone board-zone"><${BoardScreen} G=${G} /></div>
      <div className="zone seam"></div>
      <div className="zone level-zone" ref=${zoneRef}>
        ${G.board ? h`<${LevelScreen} G=${G} />` : h`<${DummyBoard} />`}
      </div>
    </div></div>
    ${ended ? h`<div className="overlay end-overlay"><${EndScreen} G=${G} /></div>` : null}
    <${TesterPanel} G=${G} />
  </div>`;
}

ReactDOM.createRoot(document.getElementById('root')).render(h`<${App} />`);
