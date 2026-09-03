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
| `piece.<colour>.boosted` (×6, `pieces/<colour>-boosted.png`) | lit-up variant shown when that colour is boosted | 256×256; placeholder is auto-derived from the base piece (brightness + sheen) — replace with a real sprite anytime |
| `special.arrow-h` `special.arrow-v` | ↔️ / ↕️ overlay | 256×256, rendered AS-IS (never tinted) |
| `special.lightning` | ⚡ overlay | 256×256, as-is |
| `special.bomb` | 💣 overlay | 256×256, as-is |
| `special.dynamite` | 🧨 (2×2 square match) overlay | 256×256, as-is |
| `special.cross` | ✚ (v21 merge combo) overlay | 256×256, as-is |
| `tile.chest` | 🎁 tile | 256×256 |
| `tile.chomper` | 😬 critter tile | 256×256 |
| `bg.main` | flat dark page | 1170×2532 mystical backdrop |
| `logo` | text `<h1>` on menu | ~1024×512 |
| `icon.moves` | 👟 | 256×256 |
| `icon.flag` | 🚩 (HUD + checkpoint) | 256×256 |
| `end.art` | end-screen bottom art panel (placeholder gradient) | ~860×500, displayed 430×250 cover |
| `menu.art` | start-screen bottom art panel | same spec as `end.art` |

## P2 — second wave

| Slot | Replaces |
| --- | --- |
| `marker.xtramove` | 🔄 board mark |
| `marker.pinata` | 🪅 board mark |
| `marker.triple` | ×3 board mark |
| `marker.food` | 🍖 chomper snack (cell overlay) |
| `tile.blocker.box` | 📦 box blocker (damage states still CSS/badge; single sprite for now) |
| `tile.blocker.water` | 💧 water blocker |
| `tile.blocker.safe` | 🔒 colour-safe blocker |
| `icon.momentum` | 🚀 meter icon |
| `icon.fillup` | 🔋 meter icon |
| `icon.snowball` | ❄️ meter icon |
| `board.cell` / `board.cell-alt` | per-cell tile backs — stretched to each cell, re-tile automatically when the board expands; include your gap/margin inside the canvas |
| `board.frame` | static decorative frame around the whole board: **512×512, 9-slice slice 96, drawn at 20px border, `fill` center** — corners (incl. medallions) stay crisp at any board size, edges stretch, the canvas center fills the area behind the cells |
| `ui.button-primary` | gradient CTA (9-slice) |
| `ui.panel` | HUD/panel surfaces (9-slice) |
| `ui.chip` | power-bar chips (9-slice) |
| `ui.progressbar-track` / `ui.progressbar-fill` | goal bar — **512×64 horizontal pill**, stretched to the bar (wide art keeps the end caps clean) |
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

## P2 — board hub (board-meta line, added 2026-09-02)

| Slot | Replaces | Spec |
| --- | --- | --- |
| `mspace.<type>` (landmark, coin, consumable, modifier, mystery, minigame_flip, minigame_scratch, metaoffer, empty, boss) | emoji on the loop spaces | 256×256 icon (M2 turns spaces into full iso tile art — same slot ids) |
| `token` | 🧗 | 256×256 |
| `die` | white CSS die | 128×128 blank die face; the rolled number is drawn on top by the UI |
| `icon.dice` `icon.coin` `icon.lap` | 🎲 🪙 🏁 (dice count, wallet, lap counter, CTAs) | 256×256 |
| `world.<n>.icon` (1–3) | 🌿 🏜️ 🏔️ header + empty spaces | 256×256 |
| `boss.<n>` (1–3) | 🌈 🗿 🐉 boss progress + offer panel | 256×256 |
| `runmod.<id>` (cpmoves, first2x, startspecial, landmark, boss6, bosscold) | run-modifier chips + reveal popup | 256×256 |
| `consumable.<id>` (hammer, bomb, shuffle) | wallet + reveal popup | 256×256 |
| `metaoffer.jackpot` | 💰 | 256×256 |
| `icon.shop` | 🛍️ top-bar shop button (buys a die) | 256×256 |
| `icon.backpack` | 🎒 collapsible items button at the Play button's bottom-left | 256×256 |
| `ui.dice-button` | round red dice CTA face | 128×128, transparent corners; count + ROLL drawn by the UI |

## Tile styles (tester-switchable piece-art sets, 2026-09-02)

The 🧪 tester panel has a **Tiles** dropdown that swaps the six piece slots (and
their boosted variants) live. `default` = the `pieces/` art mapped in skin.json.
Every other style is a folder with `red.png yellow.png green.png blue.png
purple.png orange.png` (+ `<colour>-boosted.png`), listed in
`src/assets/tile-styles.json`:

| id | folder | contents |
| --- | --- | --- |
| `default` | `pieces/` | CD art (current) |
| `gems` | `pieces-gems/` | generated faceted-gem placeholders |
| `orbs` | `pieces-orbs/` | generated glossy-sphere placeholders |
| `candy` | `pieces-candy/` | generated rounded-square placeholders |

**To add a style (Omri):** create `src/assets/pieces-<id>/` with the 6 (+6
boosted) PNGs, add a row to `tile-styles.json` (and to `TILE_STYLES` in
`tools/gen_placeholders.py` if you want placeholders generated), run
`sh sync.sh`. The choice persists in `localStorage` (`rl_tile_style`), and
`build.sh` inlines every listed style into the gated bundle.
