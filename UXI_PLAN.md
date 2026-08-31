# Ascent — UXI / visual MVP pass (branch `ophir/uxi-pass`)

Working the same playbook as the match-quest visual pass: gap table → phased,
session-sized chunks → screenshot review with the CD after every phase → art
lands through a named-slot skin system, never hardcoded. Decisions locked with
the CD (2026-08-31):

- **Mock source:** no separate blocking file — iterate on the live build,
  referencing the CD's ref library (`~/Desktop/uxi ref library`, organised per
  game / per feature) per gap row. CD reviews via annotated screenshots.
- **Skin system:** ported from match-quest (`claudeTest/Metagame2_slice/skin.js`
  + `skin.json` manifest + `styleguide.html` + placeholder ledger) so CD art
  drops into named slots with img → tint → emoji fallbacks.
- **Direction (locked 2026-08-31):** *casual-but-distinct* — toy-3D casual
  family, themed **mystical cute magic**: purple, gold, pink, white, deeper
  blues. The CD makes all assets; generated placeholders are self-labelling
  and CD files are never overwritten.
- **Fonts (locked 2026-08-31):** **Fruktur** for titles, **Alegreya Sans
  ExtraBold** for running text. Files in `src/fonts/`; inlined as data URIs
  by `build.sh` for the gated bundle.

## 00 · Read me — open questions for the CD

1. ~~Display font~~ — resolved: Fruktur (titles) + Alegreya Sans ExtraBold (running text).
2. ~~Palette~~ — resolved: mystical cute magic — purple/gold/pink/white/deep
   blues. Token layer in `styles.css` `:root`; redline any token value freely.
3. **The run bar as the theme carrier** — proposal, reframed for the theme: the
   run-long bar becomes a stylised *magical ascent* (enchanted trail, checkpoint
   flags that plant with a burst, summit/final-flag marker). Confirm before Phase A.
4. **Menu screen** — keep seed/toggles for playtesting but move them into a
   collapsed dev drawer (match-quest pattern), player-facing start stays clean. OK?

## What already works (do not redo)

| Thing | Notes |
| --- | --- |
| Juice layer | Pop-kind animations (boom/zap/line/sweep/special), particles, screen shake, spawn bounce, chomp bite — solid foundation, only re-tuned in the final motion pass |
| Low-moves danger | Vignette pulse escalating at ≤3/≤2/≤1 moves + red moves pill — keep, restyle only |
| Inline mid-run draft | Board-stays-visible drafting was deliberate tester feedback — keep the concept, upgrade the presentation |
| Run bar mechanics | Equal-spaced checkpoint ticks + segment-interpolated fill — logic stays, becomes the visual hero |
| Meters | Fill-up / momentum / snowball bars are functionally clear — consolidate + restyle, don't redesign |
| Layout skeleton | Single-column mobile flow, `useCellSize` responsive board — sound |

## The gaps

Sizes: S = under an hour, M = a session chunk, L = a full session.
Refs cite folders in `~/Desktop/uxi ref library`.

| # | Build has | Target | Size | Ref |
| --- | --- | --- | --- | --- |
| G1 | Bare near-black page, no identity | Themed app shell: full-viewport mystical-magic backdrop (slot `bg.main`), consistent surface/chrome tokens | M | capybara go, afk journey (world backdrops) |
| G2 | System font everywhere, plain white titles | Display font on titles/CTAs/HUD numbers, white-with-outline title treatment, type scale tokens | S | match masters, brawl stars (HUD type) |
| G3 | Emoji as every icon (🚩👟🔋🚀❄️🪅🎁😬 + specials ↔️⚡💣) | Every currency/marker/special is an ICON slot; code draws counts beside icons; no emoji in final UI (emoji stay as fallback tier) | M (spread across phases) | monopoly go (currency icons) |
| G4 | HUD: flat pill, thin 8px bar, tiny ticks | Hero run-bar: enchanted-trail bar, flag ticks that plant/celebrate when crossed, summit marker, score readout with display type; moves as a prominent boot/energy counter | L | monopoly go (progress events), match masters |
| G5 | Up to 3 stacked meter rows eating vertical space | Consolidated compact meter cluster (icon + slim bar), consistent with HUD styling | M | clash royale (elixir-style compact meters) |
| G6 | Tiles: CSS-gradient roundrects on faint grey bgcells | Piece art slots (`piece.0-5`, rendered near-touching, no plates behind skinned pieces), board container/frame slot, tile-well texture | L | match masters (board), disney solitaire |
| G7 | Specials: emoji overlaid on a colored tile | Dedicated special-piece slots (arrow-h/v, lightning, bomb) rendered AS-IS (never tinted), countdown badge restyled | M | match masters (special pieces) |
| G8 | Cell marks: emoji + colored inset squares (🔄 mark, 🪅 piñata pill, ×3 pill) | Marker slots with proper board-anchored badges; hit-counter styling for piñata | M | angry birds 2, rush royale (board modifiers) |
| G9 | Draft cards: plain dark rectangles, tiny cluster tag | The roguelite's core moment: rarity-framed cards (cluster color language, legendary shine/glow), icon slots, tactile press states | L | archero 2, capybara go (pick-3 screens), dicero |
| G10 | Checkpoint overlay: generic grey panel + text | Celebration beat: flag-plant moment, burst FX, granted moves counting up, distinct final-flag variant ("endless chase begins") | M | monopoly go (milestone events), brawl stars |
| G11 | End screens: bare text on black | Win/loss art panel slots, score count-up, styled build recap, prominent replay CTA | M | brawl stars, clash royale (end-of-match) |
| G12 | Menu: dev controls exposed (seed input, toggles) | Clean player-facing start (logo slot, single CTA); seed/draft/colour toggles + stats into a collapsed DEV drawer | M | squad busters (lobby simplicity) |
| G13 | Callouts: grey pills, fixed at 34% viewport | Display-type callouts with kind-specific styling (reward gold / danger red / combo orange), positioned relative to board | S | match masters (in-level callouts) |
| G14 | Power-bar chips: emoji pills + plain info strip | Icon-slot chips with count badges, styled active/used states, info bubble anchored to the chip | M | afk journey (loadout rows) |
| G15 | Inline draft can land below the fold on short screens | Draft presented as a bottom sheet sliding over (not under) the layout — board stays visible above, no scroll needed | M | — (fix, not a ref) |

## Phases — one PR per phase (Omri ships fast on `main`; keep rebases cheap)

| Phase | Gaps | Contents |
| --- | --- | --- |
| **0 · Plumbing** | — | Port `skin.js` (with `.slot-ic` fix) + `skin.json` + `styleguide.html` + `placeholders.sha1` ledger; fonts dir + Gasoek One; CSS design-token layer (`:root` palette/radii/shadows/type scale); `.claude/launch.json` + `sync.sh` (done, ship in this PR); ASSET_MANIFEST.md skeleton |
| **A · Shell & HUD** | G1 G2 G4 G5 | App backdrop, typography pass, hero run-bar, meter cluster |
| **B · Board zone** | G6 G7 G8 | Board chrome, piece/special/marker slots, near-touching pieces |
| **C · Draft & checkpoint** | G9 G10 G15 | Premium draft cards, bottom-sheet inline draft, checkpoint celebration |
| **D · Menu & end** | G11 G12 G13 G14 | Clean menu + dev drawer, end screens, callouts, power-bar chips |
| **E · Motion & assets** | G3 + polish | Re-tune juice against the new art; integrate CD asset waves as they land (slots make this ongoing, not blocking) |

## Ground rules

- **Shell/UI only.** All work in `src/app.js` (UI section) + `src/styles.css`.
  Never touch `src/shared/*` for visuals — it's mirrored with the proto repo.
  Game logic, economy, telemetry untouched.
- **Every visual through the skin manifest** with a working fallback chain
  (img → tint → current emoji/CSS). The game must remain fully playable with
  zero art files present.
- **CD art is sacred:** files whose hash isn't in `placeholders.sha1` are user
  art and are never overwritten. Generated placeholders label themselves.
- **Screenshot review every phase** before its PR opens; CD redlines with
  numbered fix lists.
- `docs/index.html` regeneration follows CLAUDE.md (`M3_PASSPHRASE=… sh build.sh`);
  the passphrase is never committed or written to any file.
- Results of each phase get written back into this file (status column) so any
  session can resume.

## Status

- [x] Phase 0 — done 2026-08-31: skin.js loader + `assets/skin.json` manifest +
  `assets/styleguide.html` + `placeholders.sha1` ledger; fonts wired (dev
  @font-face + data-URI inlining in build.sh — **build.sh changed**, flag in
  PR); `:root` design-token layer + mystical palette applied across styles.css;
  launch.json + sync.sh dev loop. ASSET_MANIFEST.md holds the slot taxonomy.
- [ ] Phase A
- [ ] Phase B
- [ ] Phase C
- [ ] Phase D
- [ ] Phase E
