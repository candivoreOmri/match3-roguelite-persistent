# Ascent — asset manifest (skin slots)

Every visual lands in a **named slot** wired through `src/assets/skin.json`:

```json
{ "slots": { "piece.red": "pieces/red.png" } }
```

Paths are relative to `src/assets/`. A slot missing from the manifest falls
back to the current emoji/CSS rendering — the game always plays with zero art.
Drop a file in, add its line to `skin.json`, reload. No code changes.

**Status (2026-08-31):** every slot has a generated, self-labelling placeholder
(colour-correct pieces, emoji-true icons), produced by
`python3 tools/gen_placeholders.py`. To replace one hands-on: **paint over /
overwrite the PNG at its canonical path** — same filename, done. The generator
can be rerun safely at any time: it hashes files against
`src/assets/placeholders.sha1` and never touches a file whose hash isn't in
the ledger (that's yours).

**Hard rules** (same as match-quest):
1. CD art files are never overwritten. Generated placeholder art is recorded in
   `src/assets/placeholders.sha1`; a file whose hash isn't in that ledger is CD
   art and is sacred.
2. Generated art must be a self-labelling placeholder (visibly says its slot name).
3. Approvals flow one way: CD approves in screenshots; sessions never "improve" approved art.
4. Fallbacks work forever — never remove an emoji/CSS fallback when a slot gains art.

Review surface: `http://localhost:<port>/src/assets/styleguide.html` (run `sh sync.sh` first).

## Canvas conventions

| Kind | Canvas | Notes |
| --- | --- | --- |
| Pieces / specials / tile art | 256×256 transparent PNG | square, art fills ~92% so pieces read near-touching |
| Icons | 256×256 transparent PNG | displayed 16–48px, keep silhouettes bold |
| 9-slice UI chrome | 128×128 PNG | slice 42 (corners 42px) |
| Backdrop | 1170×2532 | portrait, safe-area aware top/bottom |
| Logo | ~1024×512 transparent PNG | menu title lockup |

## P1 — first wave (highest screen-time)

| Slot | Replaces | Spec |
| --- | --- | --- |
| `piece.red` `piece.yellow` `piece.green` `piece.blue` `piece.purple` `piece.orange` | CSS-gradient tiles (`.bg0`–`.bg5`) | 256×256; colour order matches `.bg0`–`.bg5` |
| `special.arrow-h` `special.arrow-v` | ↔️ / ↕️ overlay | 256×256, rendered AS-IS (never tinted) |
| `special.lightning` | ⚡ overlay | 256×256, as-is |
| `special.bomb` | 💣 overlay | 256×256, as-is |
| `tile.chest` | 🎁 tile | 256×256 |
| `tile.chomper` | 😬 critter tile | 256×256 |
| `bg.main` | flat dark page | 1170×2532 mystical backdrop |
| `logo` | text `<h1>` on menu | ~1024×512 |
| `icon.moves` | 👟 | 256×256 |
| `icon.flag` | 🚩 (HUD + checkpoint) | 256×256 |
| `end.art` | end-screen bottom art panel (placeholder gradient) | ~860×500, displayed 430×250 cover |

## P2 — second wave

| Slot | Replaces |
| --- | --- |
| `marker.xtramove` | 🔄 board mark |
| `marker.pinata` | 🪅 board mark |
| `marker.triple` | ×3 board mark |
| `icon.momentum` | 🚀 meter icon |
| `icon.fillup` | 🔋 meter icon |
| `icon.snowball` | ❄️ meter icon |
| `board.cell` / `board.cell-alt` | checkerboard bg cells |
| `board.frame` | (none yet) 9-slice board frame |
| `ui.button-primary` | gradient CTA (9-slice) |
| `ui.panel` | HUD/panel surfaces (9-slice) |
| `ui.chip` | power-bar chips (9-slice) |
| `ui.progressbar-track` / `ui.progressbar-fill` | run bar + meters |
| `ui.overlay-card` | checkpoint/draft panels (9-slice) |

## P3 — power-up icons (rolling)

Convention: `icon.powerup.<id>`, 256×256. Emoji fallback holds per icon until
its file lands. Roster ids: `aftershock autoexplode blast bombchance bombtrail
boost chests chomper colclear converter conveyor countdown diagswap doublebite
expandcol expandrow fillup flood fusionmove gourmet lava lifesaver matryoshka
momentum pinata purge rowclear snowball snowcrush snowpaint spawner spawnweight
specialscore spicytrail square squarebomb squarescore sweep tempo tripletile
twinchomper xtramove` (snowcrush/snowpaint are variant-only, defined in app.js).

Colour-bearing power-ups (e.g. `boost`) may add bespoke per-colour files:
`icon.powerup.boost.red` etc. — resolution order is bespoke → base → emoji.

## Build note

`build.sh` bundles only CSS+JS. Fonts are inlined as data URIs at build time.
When the first P1 art lands, `build.sh` gains a step that inlines `skin.json`
with data-URI values as `window.__SKIN_INLINE__` (skin.js already reads it).
