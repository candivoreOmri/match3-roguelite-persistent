/* ============================================================================
   SHARED POWER-UPS — one roster for every roguelite variant.
   Requires shared/engine.js loaded first (uses K, CONFIG at runtime).
   Add new power-ups HERE so all variants receive them; variant-specific
   remaps (level vs checkpoint scoping) live in each variant's app.js.
   ========================================================================== */
'use strict';

/* ============================== POWER-UPS =================================
   Each power-up is self-contained:
     mods(m, pick, game)          — fold static modifiers into game.mods
                                    (recomputed on every pick / level start)
     onMatch(game, pick, group, api) — react to a match group this step
     onLevelStart(game, pick)     — per-level setup
     roll(game)                   — extra data rolled when offered (e.g. colour)
     desc(pick)                   — one-line card text
   Cumulative picks work by folding mods per pick, or by onMatch firing once
   per pick. `stackable:false` removes it from the pool once picked.
   ========================================================================== */
const POWERUPS = {
  boost: {
    id: 'boost', name: 'Colour boost', icon: '🎨', cluster: 'colour', stackable: true,
    roll(g) {
      const owned = Object.keys(g.mods.boosts).map(Number);
      if (owned.length && g.rng() < CONFIG.BOOST_SAME_COLOUR_CHANCE)
        return { color: owned[Math.floor(g.rng() * owned.length)] };
      return { color: Math.floor(g.rng() * g.opts.colours) };
    },
    desc: p => `${COLOR_NAMES[p.color]} tiles score +1 point each (stacks)`,
    mods(m, p) { m.boosts[p.color] = (m.boosts[p.color] || 0) + 1; },
  },
  flood: {
    id: 'flood', name: 'Flood', icon: '🌊', cluster: 'colour', stackable: true, requiresBoost: true,
    disabled: true, // pulled from the draft pool for now (2026-08-13) — effect code kept for re-enable
    desc: () => 'Matching a boosted colour converts 1 adjacent tile to that colour',
    onMatch(g, p, group, api) { if (g.mods.boosts[group.color]) api.flood(group, group.color); },
  },
  spawner: {
    id: 'spawner', name: 'Special spawner', icon: '✨', cluster: 'colour', stackable: true, requiresBoost: true,
    desc: () => `Boosted-colour matches: ${Math.round(CONFIG.SPECIAL_SPAWNER_CHANCE * 100)}% chance to spawn a special piece`,
    onMatch(g, p, group, api) {
      if (g.mods.boosts[group.color] && g.rng() < CONFIG.SPECIAL_SPAWNER_CHANCE) api.spawnRandomSpecial(group);
    },
  },
  fillup: {
    id: 'fillup', name: 'Fill-up', icon: '🔋', cluster: 'colour', stackable: false, requiresBoost: true,
    desc: () => `Every ${CONFIG.FILL_UP_THRESHOLD} boosted tiles matched: run multiplier +1`,
    mods(m) { m.fillup = true; }, // drives the battery meter in the level UI
    onMatch(g, p, group) {
      if (!g.mods.boosts[group.color]) return;
      g.run.fillCount += group.cells.length;
      while (g.run.fillCount >= CONFIG.FILL_UP_THRESHOLD * (g.run.fillTriggers + 1)) {
        g.run.fillTriggers++; g.run.multiplier++;
        g.callout(`🔋 Multiplier ×${g.run.multiplier}!`);
      }
    },
  },
  sweep: {
    id: 'sweep', name: 'Vertical sweep', icon: '🧹', cluster: 'colour', stackable: false,
    desc: () => 'Vertical matches you make also clear every tile of that colour',
    // group.active = the match contains a cell the player just swapped.
    // Cascade/auto-explode matches must NOT sweep, or chains snowball into
    // whole levels clearing themselves off a single move.
    onMatch(g, p, group, api) {
      if (group.active && group.runs.some(r => r.dir === 'v')) api.clearColor(group.color, group);
    },
  },
  bombchance: {
    id: 'bombchance', name: 'Bomb chance', icon: '🎲', cluster: 'chaos', stackable: true,
    desc: () => `+${Math.round(CONFIG.BOMB_CHANCE_PER_PICK * 100)}% chance each refill tile spawns as a bomb (stacks)`,
    mods(m) { m.bombChance += CONFIG.BOMB_CHANCE_PER_PICK; },
  },
  autoexplode: {
    id: 'autoexplode', name: 'Auto-explode', icon: '🔥', cluster: 'chaos', stackable: false,
    desc: () => 'Every special on the board explodes at the end of each move',
    mods(m) { m.autoExplode = true; },
  },
  countdown: {
    id: 'countdown', name: 'Countdown', icon: '⏲️', cluster: 'chaos', stackable: false,
    desc: () => `Specials get a ${CONFIG.COUNTDOWN_TIMER_START}-move fuse, then explode on their own`,
    mods(m) { m.countdown = true; },
  },
  blast: {
    id: 'blast', name: 'Blast radius', icon: '💥', cluster: 'chaos', stackable: true,
    desc: () => 'Bomb explosions are one ring bigger (stacks)',
    mods(m) { m.blastBonus += CONFIG.BLAST_RADIUS_BONUS; },
  },
  specialscore: {
    id: 'specialscore', name: 'Special score', icon: '💎', cluster: 'chaos', stackable: true,
    desc: () => 'Special pieces score +1 point when they explode (stacks)',
    mods(m) { m.specialScore += 1; },
  },
  // Like sweep, both line-clears are active-only: cascade matches triggering
  // them causes runaway chains (telemetry showed 120 pts/move at L4).
  rowclear: {
    id: 'rowclear', name: 'Row clear', icon: '✂️', cluster: 'chaos', stackable: false,
    desc: () => 'Horizontal matches you make clear the whole row',
    onMatch(g, p, group, api) { if (group.active) api.clearLines(group, 'h'); },
  },
  colclear: {
    id: 'colclear', name: 'Column clear', icon: '🪓', cluster: 'chaos', stackable: false,
    desc: () => 'Vertical matches you make clear the whole column',
    onMatch(g, p, group, api) { if (group.active) api.clearLines(group, 'v'); },
  },
  // Expand was one power-up (+1 row AND +1 col per pick) — that made stacked
  // picks near-unlosable, so it's split per axis. Still cumulative; each pick
  // now grows one dimension instead of two (MAX_BOARD caps the total).
  expandrow: {
    id: 'expandrow', name: 'Expand rows', icon: '📏', cluster: 'utility', stackable: true,
    desc: () => 'Board grows by one row from the next level (stacks)',
    mods(m) { m.expandRows += 1; },
  },
  expandcol: {
    id: 'expandcol', name: 'Expand columns', icon: '📐', cluster: 'utility', stackable: true,
    desc: () => 'Board grows by one column from the next level (stacks)',
    mods(m) { m.expandCols += 1; },
  },
  xtramove: {
    id: 'xtramove', name: 'Xtra move tiles', icon: '🔄', cluster: 'utility', stackable: true,
    desc: () => `${CONFIG.XTRA_MOVE_TILES_PER_LEVEL} marked cells per level; match over one yourself to refund the move (max 1 per move, cascades don't count)`,
    mods(m) { m.marks += CONFIG.XTRA_MOVE_TILES_PER_LEVEL; },
  },
  square: {
    id: 'square', name: 'Square match', icon: '🀄', cluster: 'utility', stackable: false,
    desc: () => '2×2 matches count, and spawn a dynamite that blasts a + shape',
    mods(m) { m.square = true; },
  },
  squarebomb: {
    id: 'squarebomb', name: 'Square bomb', icon: '💣', cluster: 'utility', stackable: false, requiresSquare: true,
    desc: () => 'Square matches spawn a bomb instead of a dynamite',
    mods(m) { m.squareBomb = true; },
  },
  squarescore: {
    id: 'squarescore', name: 'Square bonus', icon: '🔷', cluster: 'utility', stackable: false, requiresSquare: true,
    desc: () => `Square matches score +${CONFIG.SQUARE_BONUS_POINTS} points`,
    onMatch(g, p, group, api) { if (group.square) api.addBonus(CONFIG.SQUARE_BONUS_POINTS); },
  },
  lifesaver: {
    id: 'lifesaver', name: 'Lifesaver', icon: '🛟', cluster: 'utility', stackable: false,
    disabled: true, // pulled from the draft pool in ALL variants (2026-08-20, Omri) — shop-branch sells it as a consumable charge instead
    desc: () => `Once per run: running out of moves grants +${CONFIG.LIFESAVER_BONUS_MOVES} moves instead of losing`,
    mods(m) { m.lifesaver = true; },
  },
  converter: {
    id: 'converter', name: 'Converter', icon: '🔀', cluster: 'colour', stackable: false, requiresBoost: true,
    desc: () => 'Matches you make convert one random tile to a boosted colour',
    onMatch(g, p, group, api) {
      if (!group.active) return; // player-made matches only, never cascades
      const owned = Object.keys(g.mods.boosts).map(Number);
      if (owned.length) api.convertRandom(owned[Math.floor(g.rng() * owned.length)]);
    },
  },
  spawnweight: {
    id: 'spawnweight', name: 'Spawn weight', icon: '🧲', cluster: 'colour', stackable: true, requiresBoost: true,
    desc: () => 'Boosted colours appear more often in refill tiles (stacks)',
    mods(m) { m.spawnWeight += CONFIG.SPAWN_WEIGHT_PER_PICK; },
  },
  matryoshka: {
    id: 'matryoshka', name: 'Matryoshka', icon: '🪆', cluster: 'chaos', stackable: false,
    desc: () => 'Exploding specials leave the next weaker special behind (⚡→💣→➡️→🧨)',
    mods(m) { m.matryoshka = true; },
  },
  aftershock: {
    id: 'aftershock', name: 'Aftershock', icon: '💢', cluster: 'chaos', stackable: false,
    desc: () => 'Explosions scorch surrounding tiles for one move — matching a scorched tile sets off a small blast',
    mods(m) { m.aftershock = true; },
  },
  tempo: {
    id: 'tempo', name: 'Tempo', icon: '🎺', cluster: 'utility', stackable: false,
    desc: () => `The first match of each level scores ×${CONFIG.TEMPO_MULT}`,
    mods(m) { m.tempo = true; },
  },
  snowball: {
    id: 'snowball', name: 'Snowball', icon: '❄️', cluster: 'utility', stackable: false,
    desc: () => `Making a match gives bonus score, increases by 1 every ${CONFIG.SNOWBALL_MOVES_PER_POINT} moves`,
    // Run-scoped counter that never resets between levels; cascades don't earn
    // the bonus. Nerfed after tester data (v6): stacked per-move growth let a
    // double-snowball build clear L6 in 4 moves at 253 pts/move.
    onMatch(g, p, group, api) {
      if (group.active) api.addBonus(Math.ceil((g.run.snowball || 0) / CONFIG.SNOWBALL_MOVES_PER_POINT));
    },
  },
  fusionmove: {
    id: 'fusionmove', name: 'Fusion energy', icon: '🔗', cluster: 'chaos', stackable: false,
    desc: () => `Merging two special pieces grants +${CONFIG.MERGE_BONUS_MOVES} move`,
    onMerge(g) {
      g.movesLeft += CONFIG.MERGE_BONUS_MOVES;
      g.callout(`🔗 Fusion: +${CONFIG.MERGE_BONUS_MOVES} move!`);
    },
  },
  momentum: {
    id: 'momentum', name: 'Momentum', icon: '🚀', cluster: 'utility', stackable: true,
    desc: () => `Every 4+ match you make fills a bar; a full bar pays +1 move (stacks shrink the bar)`,
    // counts once per group even with multiple copies; bar carries across levels
    onMatch(g, p, group, api) {
      if (!group.active || group.cells.length < 4 || group._momentumCounted) return;
      group._momentumCounted = true;
      g.run.momentum = (g.run.momentum || 0) + 1;
      const picks = g.run.picks.filter(x => x.id === 'momentum').length;
      const need = Math.max(CONFIG.MOMENTUM_MIN, CONFIG.MOMENTUM_BASE - (picks - 1));
      if (g.run.momentum >= need) {
        g.run.momentum -= need;
        g.movesLeft++;
        g.callout('🚀 Momentum: +1 move!');
      }
    },
  },
  purge: {
    id: 'purge', name: 'Colour purge', icon: '🌪️', cluster: 'colour', stackable: false,
    desc: () => '4+ matches you make also clear every tile of that colour',
    onMatch(g, p, group, api) {
      if (group.active && group.cells.length >= 4) api.clearColor(group.color, group);
    },
  },
  chomper: {
    id: 'chomper', name: 'Chomper', icon: '😬', cluster: 'utility', stackable: false,
    // NOTE: its movement direction mirrors the player's last swap — deliberately
    // SECRET. Never surface this in any text, tooltip, or visual indicator.
    desc: () => 'A hungry critter roams the board — after each move you make it eats one piece at full value (specials detonate when eaten)',
    mods(m) { m.chomper = true; },
    onLevelStart(g) {
      let guard = 0;
      while (guard++ < 300) {
        const k = g.rollInteriorCell(); // never on the edge
        if (g.marks.has(k) || g.pinatas.has(k) || g.triples.has(k)) continue;
        const [r, c] = k.split(',').map(Number);
        const t = g.board[r][c];
        if (!t || t.chest || t.chomper) continue;
        g.board[r][c] = { id: g.tileId++, color: -2, chomper: true, special: null, dir: null, countdown: null };
        return;
      }
    },
  },
  twinchomper: {
    id: 'twinchomper', name: 'Twin Chomper', icon: '👯', cluster: 'utility', stackable: false, requiresChomper: true,
    desc: () => 'A second Chomper joins the board',
    onLevelStart(g) {
      let guard = 0;
      while (guard++ < 300) {
        const k = g.rollInteriorCell();
        if (g.marks.has(k) || g.pinatas.has(k) || g.triples.has(k)) continue;
        const [r, c] = k.split(',').map(Number);
        const t = g.board[r][c];
        if (!t || t.chest || t.chomper) continue;
        g.board[r][c] = { id: g.tileId++, color: -2, chomper: true, special: null, dir: null, countdown: null };
        return;
      }
    },
  },
  doublebite: {
    id: 'doublebite', name: 'Double Bite', icon: '🦷', cluster: 'utility', stackable: true, requiresChomper: true,
    desc: () => 'Chomper takes an extra step and meal each move (stacks)',
    mods(m) { m.doubleBite += 1; },
  },
  gourmet: {
    id: 'gourmet', name: 'Gourmet', icon: '🍽️', cluster: 'utility', stackable: false, requiresChomper: true,
    desc: () => 'Pieces Chomper eats score double',
    mods(m) { m.gourmet = true; },
  },
  spicytrail: {
    id: 'spicytrail', name: 'Spicy Trail', icon: '🌶️', cluster: 'utility', stackable: false, requiresChomper: true,
    desc: () => 'Tiles Chomper leaves behind are scorched for a move — matching one sets off a small blast',
    mods(m) { m.spicyTrail = true; },
  },
  bombtrail: {
    id: 'bombtrail', name: 'Bomb Trail', icon: '🐾', cluster: 'utility', stackable: false, requiresChomper: true,
    desc: () => 'Chomper leaves a live bomb in every tile he vacates',
    mods(m) { m.chomperBomb = true; },
  },
  conveyor: {
    id: 'conveyor', name: 'Conveyor belt', icon: '⚙️', cluster: 'utility', stackable: false,
    desc: () => 'After each move, every piece on the board edge rotates one step clockwise — specials and all',
    mods(m) { m.conveyor = true; },
  },
  lava: {
    id: 'lava', name: 'Floor is lava', icon: '🌋', cluster: 'chaos', stackable: false,
    desc: () => 'After each move, the entire bottom row melts away — a board effect, not a match you make',
    mods(m) { m.lava = true; },
  },
  diagswap: {
    id: 'diagswap', name: 'Diagonal swap', icon: '⤢', cluster: 'utility', stackable: false,
    desc: () => 'You can swap diagonally — matches still only form in straight lines',
    mods(m) { m.diagSwap = true; },
  },
  pinata: {
    id: 'pinata', name: 'Piñata tiles', icon: '🪅', cluster: 'utility', stackable: false,
    desc: () => `${CONFIG.PINATA_TILES} marked tiles; ${CONFIG.PINATA_HITS} matches over one pays +${CONFIG.PINATA_POINTS} points (cascades count; resets each level)`,
    onLevelStart(g) {
      let guard = 0;
      while (g.pinatas.size < CONFIG.PINATA_TILES && guard++ < 300) {
        const k = g.rollInteriorCell(); // never on the board edge
        if (!g.marks.has(k) && !g.pinatas.has(k) && !g.triples.has(k)) g.pinatas.set(k, CONFIG.PINATA_HITS);
      }
    },
  },
  tripletile: {
    id: 'tripletile', name: 'Triple tile', icon: '3️⃣', cluster: 'utility', stackable: false,
    desc: () => `One marked tile per level; matching over it makes the whole move score ×${CONFIG.TRIPLE_TILE_MULT} (one use)`,
    onLevelStart(g) {
      let guard = 0;
      while (g.triples.size < CONFIG.TRIPLE_TILES && guard++ < 300) {
        const k = g.rollInteriorCell(); // never on the board edge
        if (!g.marks.has(k) && !g.pinatas.has(k) && !g.triples.has(k)) g.triples.add(k);
      }
    },
  },
  chests: {
    id: 'chests', name: 'Treasure chests', icon: '🎁', cluster: 'utility', stackable: false,
    desc: () => `${CONFIG.CHEST_COUNT} chests drop in at the top each level — at the bottom they pay +${CONFIG.CHEST_POINTS} points, or +${CONFIG.CHEST_MOVES} moves when you're low`,
    onLevelStart(g) {
      const cols = [...Array(g.cols).keys()];
      for (let i = 0; i < CONFIG.CHEST_COUNT && cols.length; i++) {
        const c = cols.splice(Math.floor(g.rng() * cols.length), 1)[0];
        g.board[0][c] = { id: g.tileId++, color: -1, chest: true, special: null, dir: null, countdown: null };
      }
    },
  },
};
// Draft tiers: 1 = gentle (offered from level 1), 2 = strong (offered from
// CONFIG.STRONG_POWERUPS_FROM_LEVEL on). Early levels can't snowball off a
// premium pick like sweep or auto-explode.
const POWERUP_TIERS = {
  boost: 1, fillup: 1, countdown: 1, blast: 1, specialscore: 1,
  expandrow: 1, expandcol: 1, xtramove: 1, square: 1, lifesaver: 1,
  tempo: 1, snowball: 1, pinata: 1, diagswap: 1, fusionmove: 1, momentum: 1,
  squarescore: 1, squarebomb: 2,
  gourmet: 1, twinchomper: 2, doublebite: 2, spicytrail: 2, bombtrail: 2,
  spawner: 2, bombchance: 2, autoexplode: 2, rowclear: 2, colclear: 2, flood: 2,
  converter: 2, spawnweight: 2, matryoshka: 2, aftershock: 2, chests: 2, tripletile: 2, purge: 2,
  conveyor: 2, chomper: 1,
  sweep: 3, // legendary — tester data: cascade-scale colour wipes on demand
  lava: 3,  // legendary — a free row clear every single move
};
for (const [id, tier] of Object.entries(POWERUP_TIERS)) if (POWERUPS[id]) POWERUPS[id].tier = tier;

const POWERUP_LIST = Object.values(POWERUPS);

