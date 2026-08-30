# Match-3 Roguelite — Ascent (persistent-board variant)

Playtest build: https://candivoreomri.github.io/match3-roguelite-persistent/ (passphrase-gated — ask Omri).

A variant of the roguelite match-3 prototype: **no levels — one persistent board per run**, with a run-long score bar and cumulative checkpoints (draft + move grant on crossing; endless chase after the final flag). Vanilla JS + React UMD + htm, vendored — **no build step, no npm, no dependencies**.

## Layout

| Path | What it is |
|---|---|
| `src/` | **The source of truth.** `app.js` (game UI + variant logic), `styles.css`, `shared/engine.js` + `shared/powerups.js` (match-3 engine + power-up roster), `vendor/` (React UMD, htm), `index.html` (dev harness). |
| `build.sh` | Bundles `src/` into a single self-contained HTML file, AES-encrypts it behind the playtest passphrase, and writes the result to `./index.html`. |
| `index.html` | **Generated file** — the passphrase-gated playtest build that GitHub Pages serves. **Never hand-edit it**; edit `src/`, then regenerate with `build.sh` and commit both together. |

## Regenerating the playtest build

```
M3_PASSPHRASE=<passphrase> sh build.sh
```

The passphrase is intentionally not stored in this repo (it's public) — ask Omri. Merging the regenerated `index.html` to `main` updates the Pages site within ~1 minute.

## Development

Serve the repo with any static file server and open `/src/`:

```
python3 -m http.server 8000
```

Workflow: branch as `<person>/<topic>`, open a PR, merge to `main` — nobody pushes to `main` directly. See `CLAUDE.md` for details.

## Sibling repo

[match3-roguelite-proto](https://github.com/candivoreOmri/match3-roguelite-proto) is the level-based original this variant forked from. `src/shared/` is intentionally identical in both repos — engine fixes should land in both.
