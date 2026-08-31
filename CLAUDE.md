# Match-3 Roguelite — Ascent (persistent) — project instructions

Vanilla JS, no build step, no npm. React UMD + htm are vendored in `src/vendor/`.

This is the **persistent-board variant**: no levels — ONE board per run, one run-long
bar with cumulative score checkpoints (draft + move grant on crossing). Since v10 the
run ENDS when the final checkpoint is crossed — leftover moves are the prize (1 die
each), not a springboard for more score. Special cells/chests DRIP in per move
(`CONFIG.DRIP`), never seeded per level. Telemetry key `rl_persistent_telemetry_v1`
(`variant:'persistent'`).

## Running locally

Serve the repo root with any static server and open `http://localhost:8000/src/`:

```
python3 -m http.server 8000
```

(Anything that serves static files works — the game is plain script tags, no bundler.)

Debug handle in the console: `window.RL = {game, CONFIG, POWERUPS, META, WORLDS, cheat}`.
Set `RL.game.fast = true` to skip animation delays in scripted tests;
`RL.cheat.cross()` jumps to the next checkpoint. Board-meta cheats:
`RL.cheat.dice(n)`, `RL.cheat.coins(n)`, `RL.cheat.lap(n)`, `RL.cheat.world(w)`,
`RL.cheat.resetMeta()`.

## Board meta layer (v9, reworked v11)

Runs are wrapped by a board-game hub (rendered on phase `'menu'`): a circular
20-space loop the player moves around by spending dice earned from runs
(win pays 1 + 1 per leftover move, crossing checkpoint 3 pays 1; carried
between runs, UNCAPPED — `DICE_CAP` is reserved for a future refill
mechanic; dice can also be bought for `DICE_PRICE_COINS`). Spaces pay
coins / consumables / one-run modifiers / mini-games (empty spaces do
nothing — flavour text was cut, and the meta offer auto-applies, no
accept/decline); each lap banks +1 starting move. After
`LAPS_TO_UNLOCK_BOSS` laps the boss REPLACES the Start-run button (it is
not a board space) — its negative modifier is announced before the run,
and clearing it advances the world. Targets AND move grants are per-world
(`WORLD_CHECKPOINTS`, `WORLD_START_MOVES`, `WORLD_CHECKPOINT_MOVES`) —
and since v12 a regular run uses only the first `WORLD_RUN_CHECKPOINTS`
flags of its world's curve (world 1: 3 flags, introductory) while the
boss always climbs all 6. World N auto-unlocks power-up batch N in the
draft pool (`POWERUP_BATCHES` — data, wrapped over each roster entry's
`disabled`; batch listing never resurrects a roster-disabled pick).
Worlds, space layouts, modifiers, and batches are all data tables in
`src/app.js` — add space types / worlds / modifiers there, never in the
engine. Meta state persists in localStorage under `rl_persistent_meta_v1`.
Consumables (hammer 🔨 = smash/detonate one tile, bomb 🧨 = blast an area,
shuffle 🔀) are usable in-run since v12 via the bar under the board — no
move cost, inventory persists in META. The power-up unlock/reveal screen
is still a future feature.
`window.M3` exposes the engine internals (`G`, `trySwap`, `resolveBoard`, …);
`trySwap` takes two cell **objects**: `trySwap({r,c},{r,c})`, not 4 numbers.

## The generated playtest build

`docs/index.html` is **generated** by `build.sh` — a single-file bundle of
`src/`, AES-encrypted behind the playtest passphrase, served by GitHub Pages.

- **Never hand-edit `docs/index.html`.** Edit `src/`, then regenerate:
  `M3_PASSPHRASE=<passphrase> sh build.sh` (passphrase not in the repo — ask Omri).
- Commit the regenerated `docs/index.html` in the same PR as the `src/` change, or leave
  it untouched and let whoever merges regenerate — but `main`'s `docs/index.html` must
  always match `main`'s `src/`.

## Workflow

- All work happens on branches named `<person>/<topic>` (e.g. `ophir/board-polish`),
  merged into `main` via pull request. **Nobody pushes to `main` directly.**
- UX/visual work usually lives in `src/app.js` + `src/styles.css`.

## Code rules

- `src/shared/engine.js` and `src/shared/powerups.js` are shared with the sibling
  repo [match3-roguelite-proto](https://github.com/candivoreOmri/match3-roguelite-proto)
  and are kept **identical** in both. Never put variant-only behaviour in them —
  that goes in `src/app.js`. If you change `shared/`, flag it in the PR so the same
  change lands in the sibling repo.
- Score economy is 1 point per piece; don't hand-tune targets.
- Intermediate checkpoints never end a run early — but since v10 the FINAL checkpoint
  DOES end the run (a win), converting leftover moves to dice. Don't reintroduce the
  endless score chase.
- The game should feel **juicy**: animation, particles, floating callouts, screen
  shake. Match that bar for any new mechanic or visual change.
