"""Turn raw game screenshots into rounded, bordered cards with a soft shadow (PNG with alpha).
Run: python bake.py   (needs Pillow). Writes assets/<name>.png and assets/meta.json."""
import json, os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
RAW, OUT = os.path.join(HERE, 'assets', 'raw'), os.path.join(HERE, 'assets')
# name: (raw file, crop box as fractions or None, output width px)
JOBS = {
    'doorrush': ('doorrush-clean.png', None, 1800),
    'maze': ('maze2-a.png', None, 1400),
    'tiledrop': ('tiledrop.png', None, 1100),
    'steps': ('steps.png', None, 1100),
    'bridge': ('bridge.png', None, 1100),
    'doorgrid': ('doorrush-clean.png', None, 1100),
    'hub': ('hub-ui.png', None, 1400),
    'detour': ('detour-b.png', None, 1200),
    'slimegate': ('slimegate-near.png', None, 1100),
    'results': ('results.png', (0.272, 0.036, 0.731, 0.972), 900),
}
BORDER, RADIUS_FRAC, PAD, BLUR = 10, 0.035, 36, 16

def bake(src, crop, width):
    im = Image.open(os.path.join(RAW, src)).convert('RGB')
    if crop:
        W, H = im.size
        im = im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
    h = round(im.height * width / im.width)
    im = im.resize((width, h), Image.LANCZOS)
    r = int(min(width, h) * RADIUS_FRAC) + BORDER
    cw, ch = width + 2 * BORDER, h + 2 * BORDER
    card = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, cw - 1, ch - 1), r, fill=255)
    card.paste(Image.new('RGBA', (cw, ch), (255, 255, 255, 255)), (0, 0), mask)
    inner = Image.new('L', (width, h), 0)
    ImageDraw.Draw(inner).rounded_rectangle((0, 0, width - 1, h - 1), r - BORDER, fill=255)
    card.paste(im, (BORDER, BORDER), inner)
    out = Image.new('RGBA', (cw + 2 * PAD, ch + 2 * PAD), (0, 0, 0, 0))
    sh = Image.new('L', out.size, 0)
    ImageDraw.Draw(sh).rounded_rectangle((PAD, PAD + 10, PAD + cw, PAD + ch + 10), r, fill=95)
    sh = sh.filter(ImageFilter.GaussianBlur(BLUR))
    out.paste(Image.new('RGBA', out.size, (43, 45, 66, 255)), (0, 0), sh)
    out.alpha_composite(card, (PAD, PAD))
    return out, {'w': out.width, 'h': out.height, 'pad': PAD, 'cardW': cw, 'cardH': ch}

meta = {}
for name, (src, crop, width) in JOBS.items():
    img, m = bake(src, crop, width)
    img.save(os.path.join(OUT, name + '.png'), optimize=True)
    meta[name] = m
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
print(json.dumps(meta))
