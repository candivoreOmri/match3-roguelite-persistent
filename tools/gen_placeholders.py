#!/usr/bin/env python3
"""Generate self-labelling placeholder art for every skin slot (see
ASSET_MANIFEST.md), write the full slot map into src/assets/skin.json, and
regenerate src/assets/placeholders.sha1.

Match-quest rules, enforced here:
  * a file whose sha1 is NOT in the current ledger is CD art -> never
    overwritten (skipped with a warning; its manifest entry is kept)
  * everything this script writes is hashed into the new ledger
  * placeholders are functional (colour-correct pieces, emoji-true icons)
    AND labelled with their slot id, so they read as replace-me files

Rerun after adding slots:  python3 tools/gen_placeholders.py
"""
import hashlib, json, os, re, sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
A = os.path.join(SRC, 'assets')
LEDGER = os.path.join(A, 'placeholders.sha1')

BODY_TTF = os.path.join(SRC, 'fonts', 'AlegreyaSans-ExtraBold.ttf')
DISPLAY_TTF = os.path.join(SRC, 'fonts', 'Fruktur-Regular.ttf')
EMOJI_TTC = '/System/Library/Fonts/Apple Color Emoji.ttc'

INK = (12, 8, 26, 255)
GOLD = (255, 213, 74, 255)

def sha1(path):
    h = hashlib.sha1()
    with open(path, 'rb') as f:
        for blk in iter(lambda: f.read(65536), b''):
            h.update(blk)
    return h.hexdigest()

def load_ledger():
    hashes = set()
    if os.path.exists(LEDGER):
        for line in open(LEDGER):
            line = line.strip()
            if line and not line.startswith('#'):
                hashes.add(line.split()[0])
    return hashes

def font(path, size):
    return ImageFont.truetype(path, size)

def emoji(ch, px):
    """Render an emoji at px size (Apple Color Emoji has fixed strikes).
    Non-emoji glyphs (e.g. diagswap's ⤢) render empty there — fall back to
    drawing the character in the body font, white with an ink outline."""
    f = ImageFont.truetype(EMOJI_TTC, 160)
    img = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
    ImageDraw.Draw(img).text((100, 100), ch, font=f, embedded_color=True, anchor='mm')
    box = img.getbbox()
    if not box or (box[2] - box[0]) < 20:
        for fallback in (BODY_TTF, '/System/Library/Fonts/Apple Symbols.ttf',
                         '/System/Library/Fonts/Helvetica.ttc'):
            try:
                img = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
                ImageDraw.Draw(img).text((100, 100), ch, font=font(fallback, 150),
                                         fill=(255, 255, 255, 255), anchor='mm',
                                         stroke_width=6, stroke_fill=INK)
                box = img.getbbox()
                if box and (box[2] - box[0]) >= 20:
                    break
            except OSError:
                continue
    if box:
        img = img.crop(box)
    return img.resize((px, max(1, int(px * img.height / img.width))) if img.width >= img.height
                      else (max(1, int(px * img.width / img.height)), px), Image.LANCZOS)

def vgrad(w, hgt, top, bot):
    img = Image.new('RGBA', (w, hgt))
    for y in range(hgt):
        t = y / max(1, hgt - 1)
        img.paste(tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,),
                  (0, y, w, y + 1))
    return img

def rounded(img, radius):
    mask = Image.new('L', img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius, fill=255)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out

def label(img, text, size=None, alpha=230, dy=0):
    """Slot-id strip along the bottom — the self-labelling part."""
    size = size or max(14, img.width // 14)
    d = ImageDraw.Draw(img)
    f = font(BODY_TTF, size)
    y = img.height - size - max(6, img.height // 40) + dy
    d.text((img.width / 2 + 1, y + 1), text, font=f, fill=(0, 0, 0, 200), anchor='ma')
    d.text((img.width / 2, y), text, font=f, fill=(255, 255, 255, alpha), anchor='ma')
    return img

def paste_center(img, art, dy=0):
    img.alpha_composite(art, ((img.width - art.width) // 2, (img.height - art.height) // 2 + dy))
    return img

# ---------------------------------------------------------------- pieces
PIECE_GRADS = {  # matches .bg0-.bg5 in styles.css (readability colours)
    'red':    ((255, 91, 77), (222, 26, 10)),
    'yellow': ((255, 223, 61), (245, 160, 0)),
    'green':  ((63, 227, 108), (10, 167, 62)),
    'blue':   ((74, 164, 255), (15, 91, 227)),
    'purple': ((194, 87, 255), (124, 20, 234)),
    'orange': ((255, 160, 46), (232, 92, 2)),
}
# distinct silhouette per colour (colour-blind rule) — regular polygons
PIECE_SIDES = {'red': 3, 'yellow': 5, 'green': 4, 'blue': 30, 'purple': 6, 'orange': 8}

def piece(slot, colour):
    img = rounded(vgrad(256, 256, *PIECE_GRADS[colour]), 44)
    d = ImageDraw.Draw(img)
    d.regular_polygon((128, 118, 62), PIECE_SIDES[colour], rotation=90,
                      fill=(255, 255, 255, 200), outline=(0, 0, 0, 60))
    return label(img, slot)

# ------------------------------------------------------------- emoji tile
def emoji_tile(slot, ch, bg=None, border=None, px=150):
    img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    if bg:
        img = rounded(vgrad(256, 256, *bg), 44)
    if border:
        ImageDraw.Draw(img).rounded_rectangle([2, 2, 253, 253], 44, outline=border, width=5)
    paste_center(img, emoji(ch, px), dy=-10)
    return label(img, slot)

def emoji_icon(slot, ch):
    """Icon slot: emoji on transparent, slot label under it."""
    img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    paste_center(img, emoji(ch, 168), dy=-18)
    return label(img, slot, size=22)

# ------------------------------------------------------------------ misc
def bg_main(slot):
    img = vgrad(1170, 2532, (28, 21, 64), (18, 13, 40))
    d = ImageDraw.Draw(img, 'RGBA')
    d.ellipse([-200, -500, 1370, 700], fill=(139, 92, 246, 60))
    d.ellipse([500, 2000, 1600, 2900], fill=(255, 122, 217, 36))
    d.ellipse([-400, 1700, 500, 2500], fill=(88, 166, 255, 26))
    import random
    rnd = random.Random(7)
    for _ in range(220):
        x, y = rnd.randrange(1170), rnd.randrange(2532)
        r = rnd.choice((1, 1, 2))
        d.ellipse([x, y, x + r, y + r], fill=(255, 255, 255, rnd.randrange(60, 150)))
    return label(img, slot + '  ·  PLACEHOLDER', size=40, alpha=110, dy=-60)

def logo(slot):
    img = Image.new('RGBA', (1024, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((512, 150), 'Match-3 Roguelite', font=font(BODY_TTF, 54),
           fill=(207, 196, 234, 255), anchor='mm')
    d.text((512, 300), 'Ascent', font=font(DISPLAY_TTF, 210), fill=(255, 255, 255, 255),
           anchor='mm', stroke_width=8, stroke_fill=INK)
    return label(img, slot, size=30, alpha=140)

def end_art(slot):
    img = vgrad(860, 500, (34, 26, 68), (58, 32, 92))
    d = ImageDraw.Draw(img, 'RGBA')
    d.ellipse([280, 120, 580, 420], fill=(255, 122, 217, 40))
    paste_center(img, emoji('🔮', 170), dy=-20)
    return label(img, slot + '  ·  PLACEHOLDER', size=30, alpha=170)

def board_cell(slot, alt):
    a = 16 if alt else 8
    img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 2, 253, 253], 28, fill=(255, 255, 255, a),
                        outline=(190, 166, 255, 34), width=4)
    d.text((128, 128), slot.split('.')[-1], font=font(BODY_TTF, 26),
           fill=(255, 255, 255, 26), anchor='mm')
    return img

def nine(slot, kind):
    """128x128 9-slice chrome (border-image slice 42)."""
    img = Image.new('RGBA', (128, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if kind == 'cta':
        img = rounded(vgrad(128, 128, (139, 92, 246), (233, 95, 208)), 40)
    elif kind == 'panel':
        img = rounded(vgrad(128, 128, (34, 26, 68), (28, 21, 56)), 40)
        ImageDraw.Draw(img).rounded_rectangle([1, 1, 126, 126], 40, outline=(64, 51, 110, 255), width=3)
    elif kind == 'card':
        img = rounded(vgrad(128, 128, (43, 33, 86), (29, 23, 64)), 40)
        ImageDraw.Draw(img).rounded_rectangle([1, 1, 126, 126], 40, outline=(85, 68, 144, 255), width=3)
    elif kind == 'chip':
        img = rounded(vgrad(128, 128, (43, 33, 86), (34, 26, 68)), 56)
        ImageDraw.Draw(img).rounded_rectangle([1, 1, 126, 126], 56, outline=(64, 51, 110, 255), width=3)
    elif kind == 'track':
        img = rounded(Image.new('RGBA', (128, 128), (28, 22, 56, 255)), 60)
        ImageDraw.Draw(img).rounded_rectangle([1, 1, 126, 126], 60, outline=(64, 51, 110, 255), width=3)
    elif kind == 'fill':
        img = rounded(vgrad(128, 128, (139, 92, 246), (255, 122, 217)), 60)
    elif kind == 'frame':
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([2, 2, 125, 125], 40, outline=(85, 68, 144, 255), width=10)
        d.rounded_rectangle([10, 10, 117, 117], 34, fill=(26, 20, 56, 235))
    return img

def marker(slot, ch=None, text=None):
    img = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    if ch:
        paste_center(img, emoji(ch, 170), dy=-14)
    else:
        ImageDraw.Draw(img).text((128, 112), text, font=font(BODY_TTF, 120),
                                 fill=GOLD, anchor='mm', stroke_width=8, stroke_fill=INK)
    return label(img, slot, size=22)

# ------------------------------------------------- power-up icon roster
def powerup_icons():
    """id -> emoji, parsed from the shared roster + the variant additions."""
    icons = {}
    for path in (os.path.join(SRC, 'shared', 'powerups.js'), os.path.join(SRC, 'app.js')):
        src = open(path, encoding='utf-8').read()
        for m in re.finditer(r"id:\s*'([a-z]+)',[^{}]*?icon:\s*'([^']+)'", src):
            icons.setdefault(m.group(1), m.group(2))
    return icons

# ---------------------------------------------------------------- build
def main():
    old_hashes = load_ledger()
    jobs = {}  # slot -> (relpath, builder)

    for colour in PIECE_GRADS:
        jobs[f'piece.{colour}'] = (f'pieces/{colour}.png', lambda s=f'piece.{colour}', c=colour: piece(s, c))
    dark = ((43, 33, 86), (24, 18, 52))
    for slot, ch in [('special.arrow-h', '↔️'), ('special.arrow-v', '↕️'),
                     ('special.lightning', '⚡'), ('special.bomb', '💣')]:
        jobs[slot] = (f'specials/{slot.split(".")[1]}.png',
                      lambda s=slot, e=ch: emoji_tile(s, e, bg=dark, border=(255, 255, 255, 170)))
    jobs['tile.chest'] = ('tiles/chest.png',
                          lambda: emoji_tile('tile.chest', '🎁', bg=((217, 165, 86), (138, 90, 29))))
    jobs['tile.chomper'] = ('tiles/chomper.png',
                            lambda: emoji_tile('tile.chomper', '😬', bg=((110, 231, 222), (15, 118, 110))))
    jobs['bg.main'] = ('app/bg-main.png', lambda: bg_main('bg.main'))
    jobs['logo'] = ('app/logo.png', lambda: logo('logo'))
    jobs['end.art'] = ('app/end-art.png', lambda: end_art('end.art'))
    for slot, ch in [('icon.moves', '👟'), ('icon.flag', '🚩'), ('icon.momentum', '🚀'),
                     ('icon.fillup', '🔋'), ('icon.snowball', '❄️')]:
        jobs[slot] = (f'icons/{slot.split(".")[1]}.png', lambda s=slot, e=ch: emoji_icon(s, e))
    jobs['marker.xtramove'] = ('markers/xtramove.png', lambda: marker('marker.xtramove', ch='🔄'))
    jobs['marker.pinata'] = ('markers/pinata.png', lambda: marker('marker.pinata', ch='🪅'))
    jobs['marker.triple'] = ('markers/triple.png', lambda: marker('marker.triple', text='×3'))
    jobs['board.cell'] = ('board/cell.png', lambda: board_cell('board.cell', False))
    jobs['board.cell-alt'] = ('board/cell-alt.png', lambda: board_cell('board.cell-alt', True))
    jobs['board.frame'] = ('board/frame.png', lambda: nine('board.frame', 'frame'))
    for slot, kind in [('ui.button-primary', 'cta'), ('ui.panel', 'panel'),
                       ('ui.chip', 'chip'), ('ui.overlay-card', 'card'),
                       ('ui.progressbar-track', 'track'), ('ui.progressbar-fill', 'fill')]:
        jobs[slot] = (f'ui/{slot.split(".")[1]}.png', lambda s=slot, k=kind: nine(s, k))
    for pid, ch in sorted(powerup_icons().items()):
        jobs[f'icon.powerup.{pid}'] = (f'powerups/{pid}.png',
                                       lambda s=f'icon.powerup.{pid}', e=ch: emoji_icon(s, e))

    slots, ledger, skipped = {}, [], []
    for slot, (rel, build) in sorted(jobs.items()):
        path = os.path.join(A, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.exists(path) and sha1(path) not in old_hashes:
            skipped.append(rel)          # CD art — sacred, keep file AND mapping
            slots[slot] = rel
            continue
        build().save(path)
        slots[slot] = rel
        ledger.append(f'{sha1(path)}  {rel}')

    with open(os.path.join(A, 'skin.json'), 'w') as f:
        json.dump({'slots': slots}, f, indent=2, sort_keys=True)
        f.write('\n')
    with open(LEDGER, 'w') as f:
        f.write('\n'.join(sorted(ledger)) + '\n')

    print(f'{len(ledger)} placeholders written, {len(skipped)} CD files kept untouched')
    for rel in skipped:
        print('  CD art kept:', rel)

if __name__ == '__main__':
    sys.exit(main())
