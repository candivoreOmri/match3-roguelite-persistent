# Board-meta UXI — bringing the match-quest two-board surface to Mage Match

Branch `ophir/board-meta-uxi`, forked 2026-09-02 from `origin/omri/board-meta`
(v16). Goal: make the movement board and the match-3 board "live in the same
world" the way match-quest does — one vertical surface, camera pan, one
backdrop, dice-driven token loop feeding runs — using the layout, button
placement and transition contracts we already validated there.

Sources of truth: match-quest `HANDOVER.md` §7c + `UX_PARITY_PLAN.md` +
Figma "Match Quest — UX Blocking (Mobile)" v2.1 (frames 01/01b/02/03/06/07/09);
product brain `docs/reboot/` (D1–D10). Omri's hub: `src/app.js` "BOARD META
LAYER" (~L494–2064), `styles.css` "board-game meta layer (v9)".

## What Omri's build has today (reviewed 2026-09-02)

- **Three separate screens** switched by `G.phase`: `BoardScreen` (hub, phase
  `menu`) → `LevelScreen` (run) → `EndScreen` (dice earned, "Back to board").
  The board is never visible during a run and vice-versa.
- **Hub**: header (world name + "World N/3" + coins + consumable counts) →
  run-modifier chips → a **circular 20-space ring** (`spaceXY`, 43.5% radius,
  12.6% square spaces, emoji per type, per-type border colours) with the token
  🧗 hopping space to space → **centre cluster** = dice count, die face, ROLL
  button, "+1 die for 50 coins", lap counter, boss progress → "Start run" /
  "Fight <boss>" CTA below → `<details>` tester tools.
- **Data-driven meta**: `WORLDS` (3, each with boss + modifier pool), `WORLD_LAYOUT`
  (20 space ids), `SPACE_TYPES`, `RUN_MODIFIERS`, `CONSUMABLES`, power-up
  batches per world; popups for space reveal, mystery box, coin-flip and scratch
  mini-games, boss offer. Landing resolver `resolveLanding` switches on type id.
- **Theme state**: hub CSS still hardcodes the pre-theme grey-blue palette
  (`#1a1e28`, `#2c3242`…), no skin slots for spaces/token/die/coins/boss.
  Popups use their own classes — need checking against the `.overlay`
  (absolute-in-frame) rule.
- Product-brain fit: "breadth from finishing worlds, depth from the movement
  board" holds — worlds + boss gate + loop payouts are already the outer loop.
  (Pet-XP laundering is Metagame-3 scope; not applicable here.)

## Gap table — match-quest contract vs Omri's hub

Sizes: S < 1h · M = session chunk · L = full session+.

| # | Match-quest says (frame) | Omri has | Adaptation | Size |
| --- | --- | --- | --- | --- |
| H1 | **One vertical surface**: `#surface` = board zone (660) + seam (100) + level zone (760) inside a 760 viewport; camera `translateY(-760)` with `.cam-level`; both zones always rendered; `showScreen` never toggles display (01→02) | Screen swap per phase | Render both zones in one `.surface` inside `.phone`; phases `level/draft/checkpoint` add `.cam-level`; `win/loss` = end **panel over the level zone**, "Back to board" pans up. React keeps the run zone mounted whenever `G.board` exists | L |
| H2 | **One unified backdrop** (`#surface-bg`, 1520 tall, slides +380 & blurs on pan); zones transparent | `bg.main` fills the frame, hub panels opaque | Tall `bg.main` (2× frame) as the surface backdrop with parallax; hub chrome goes translucent | M |
| H3 | **Isometric zero-gap zigzag loop**, container-less tile art, even counts, no 2×2 slabs, fits frame width, token right→left, camera-follow strip (token at 50%/55%) | Circle ring, square boxes, emoji | New `IsoLoop` renderer (port `meta.js:518-658` math: T 84 / SX 42 / SY 22, scaled to 430) laying the 20 spaces as a valid closed zigzag; `mspace.<type>` art slots; count pills attach to tile top | L |
| H4 | **CTA stack** (01): 84px round dice button (icon + count + "ROLL") **above** a wide 232px PLAY LEVEL; consumables ride beneath; stack hides on `.cam-level` | ROLL + die + buy inside the ring centre; Start run below the board | Move dice/roll out of the loop into the stack; "Start run" → **Play level** (wide, our existing naming); consumable slots under it; "+1 die" becomes a small pill on the dice button | M |
| H5 | **Top bar**: icons + numbers only — shop (L) · **world widget** (name, progress track, milestone stars, chest) (C) · coins pill (R) | Text header: world name + "World 1/3" + coins + item counts | World widget carries lap/boss progress (track + boss marker) instead of "Lap 0 / 0/2 laps" text; coins pill right; consumables leave the header | M |
| H6 | **PLAY transition** = parallax pan with hand-off: preview board tinted `brightness(.2)` peeks below the hub, lands pixel-exact on the level board at 980ms, HUD/loadout fade in (.35s), goal modal at 1060ms; **never render the board twice** | Hard cut to LevelScreen | React version: the level zone's real board is the "preview" (rendered once, tinted, peeking under the hub); pan untints it; HUD/chips fade in on `.arrived`. Reverse on Back to board | L |
| H7 | **Dice fly** on level end into the ROLL button (capped 8 sprites, 95ms stagger, `.dicehit` bump); board-complete checks wait for the flight | End screen text "+N dice earned" | Keep the end panel; on Back to board the dice sprites fly from panel to the dice button as the camera pans up | M |
| H8 | **Level HUD** (02): 72px MOVES block · big SCORE + target track · no coins box · no pause | Our Goals HUD (moves box + goal bar) — already this shape | Keep; hide top bar / hub CTAs on `.cam-level` | S |
| H9 | **Loadout**: slots flank a pet button, art pops out of container tops, long-press prices | Our power chips pinned at bottom | Keep chips; run-modifier chips ("Next run:") move next to Play level; consumables get their in-run bar (Omri's v12 `ConsumableBar`) styled as loadout | S |
| H10 | **Popups scope to the frame** (`.moverlay` absolute inset 0 inside `#phone`, z ≥ 78; roster popup `max-height:96%`) | `SpaceRevealPopup`, `MysteryBox`, mini-games, `BossOfferPanel` — own classes | Rebase them on our `.overlay` + `.panel`/card styles (title font, tokens, 9-slice) | M |
| H11 | **Combined pre-level popup** (03): ONE popup — level type card + modifiers + pick that starts the level; pre-level targets dropped | Boss offer panel (fight/flee) + modifiers as chips | Boss run keeps its offer panel; regular Play level starts straight into the run (draft overlay is the "pick"). Restyle boss offer as the 03 card | S |
| H12 | **Diegetic board events** (07): camera push into the token's tile, gift/upgrade in-world, burst reveal, **no modal** — the one thing match-quest never shipped | Every landing is a centered modal | Phase-last: token-anchored reveal (float from the tile, camera nudge), modal only for mini-games | L |
| H13 | **No emojis where art exists**; icons + numbers | Emoji everywhere on the hub | Slots: `mspace.<type>` ×10, `token`, `die`, `icon.dice`, `icon.coin`, `icon.lap`, `world.<n>.icon`, `boss.<n>`, `runmod.<id>`, `consumable.<id>`; placeholders via the generator; hub palette → tokens | M |
| H14 | **Dev chrome out of the frame** (collapsible dev drawer) | `<details class="tester-tools">` in the hub flow | Move into our DEV drawer pattern (menu-style) | S |

## Phases (one PR each; every phase ends with a screenshot round)

| Phase | Gaps | Contents |
| --- | --- | --- |
| **M0 · Sync + slots** | H13 | Bring latest `main` into this branch (see decision below); hub palette → tokens; slot taxonomy + placeholders for all hub art; hub popups onto `.overlay` (H10) |
| **M1 · Surface** | H1 H2 H8 | The two-zone `.surface` + camera pan + unified tall backdrop; hub/level chrome show-hide by state. Hard cut → pan, no preview trick yet |
| **M2 · Loop** | H3 | Iso zigzag loop renderer + token + camera-follow; spaces as art tiles with top-attached count pills |
| **M3 · Chrome** | H4 H5 H9 H14 | CTA stack (dice above Play level, consumables under), top bar world widget + coins pill, run-modifier placement, dev drawer |
| **M4 · Motion** | H6 H7 | Parallax hand-off (tint/untint, HUD fade-in), dice fly on Back to board |
| **M5 · Events** | H11 H12 | Boss-offer card (03), diegetic landings (07) |

## Decision needed first: syncing with `main`

`omri/board-meta` is 48 commits behind `main` (v17/v18 balance, blockers
rework, card identity, PR #28 UXI pass 2). Restructuring the hub BEFORE
syncing makes the later merge much harder. Options:

1. **(Recommended)** Ask Omri's agent to merge `main` → `omri/board-meta` now
   (the conflicts are his balance code on both sides); we rebase this branch on
   the result and start M0/M1. Unblocked meanwhile: slot taxonomy + placeholders
   (pure additions).
2. We merge `origin/main` into this branch ourselves and resolve his
   gameplay-config conflicts (risky for us to arbitrate v16-vs-v18 blocker
   rules; violates "gameplay conflicts are Omri's").

## Ground rules (carry over)

Shell/UI only (`app.js` UI + `styles.css` + assets); `shared/*` untouched;
every visual through a slot with a fallback; popups absolute inside `.phone`;
never render the board twice; loops must fit the frame width; CD art is
sacred (ledger); screenshot review per phase; PR per phase.
