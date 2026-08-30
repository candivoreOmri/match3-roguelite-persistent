# Match-3 Roguelite — Ascent (persistent) — project instructions

Vanilla JS, no build step, no npm. React UMD + htm are vendored in `src/vendor/`.

This is the **persistent-board variant**: no levels — ONE board per run, one run-long
bar with cumulative score checkpoints (draft + move grant on crossing; endless chase
after the final flag). Special cells/chests DRIP in per move (`CONFIG.DRIP`), never
seeded per level. Telemetry key `rl_persistent_telemetry_v1` (`variant:'persistent'`).

## Running locally

Serve the repo root with any static server and open `http://localhost:8000/src/`:

```
python3 -m http.server 8000
```

(Anything that serves static files works — the game is plain script tags, no bundler.)

Debug handle in the console: `window.RL = {game, CONFIG, POWERUPS, cheat}`.
Set `RL.game.fast = true` to skip animation delays in scripted tests;
`RL.cheat.cross()` jumps to the next checkpoint.
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
- Reaching a checkpoint never ends a run early — the player always plays on.
- The game should feel **juicy**: animation, particles, floating callouts, screen
  shake. Match that bar for any new mechanic or visual change.
