"""
Carrier logo asset crop + transparency pass for Fidelis Care + Wellcare.

Why this exists:
  Source files (2700x1414 Fidelis, 1560x816 Wellcare) are high-res JPGs with
  white canvas around the actual brand content. In ClearPoint's carrier grid
  card (96px tall, h-aware horizontal layout), object-contain rendering plus
  a JPG-white background made both logos look like "tiny thumbnails":
    • Fidelis whitespace above the banner pushed the brand into a thin band
    • Wellcare side-padding wasted half the card width
    • Pure-white JPG corners clashed visually with the card's bg-white/95
      over bg-cream-50 (slight cream tint)

What this does:
  1. Fidelis  — TIGHT bbox crop of the full logo (mascot + banner together),
                producing a ~1.7:1 aspect ratio that fills the card both
                horizontally AND vertically when paired with a modest CSS
                scale. Mascot + wordmark visible, brand identity intact.
  2. Wellcare — TIGHT bbox crop around the teal circle.
  Both saved as PNGs with white pixels converted to transparent so the
  card's cream-tinted background shows through cleanly around the brand
  (matching the pattern used by Cigna, Anthem, Wellpoint).

Reproducible — `python scripts/crop-carrier-logos.py` from project root
regenerates both files from the originals on the user's Desktop.
"""
from PIL import Image
from pathlib import Path

CARRIERS = Path(__file__).resolve().parents[1] / 'public' / 'carriers'
DESKTOP = Path.home() / 'OneDrive' / 'Desktop'
FIDELIS_SRC = DESKTOP / 'Fidelis_Care_Logo.jpg'
WELLCARE_SRC = DESKTOP / 'wellcare_Logo.jpg'


def tight_bbox_rgb(img, *, white_threshold=240):
    """Bounding box of non-white pixels.

    A pixel is considered "white background" if all three RGB channels are
    >= white_threshold. Returns (left, top, right, bottom) or None for an
    entirely-white image. Samples every 2 px for speed; padded by step for
    safety so we don't shave actual content.
    """
    rgb = img.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    left, top, right, bottom = w, h, 0, 0
    found = False
    step = 2
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            if min(r, g, b) < white_threshold:
                found = True
                if x < left: left = x
                if x > right: right = x
                if y < top: top = y
                if y > bottom: bottom = y
    if not found:
        return None
    return (max(0, left - step), max(0, top - step),
            min(w, right + step), min(h, bottom + step))


def white_to_transparent(img, *, white_threshold=240, soft_edge=8):
    """Convert near-white pixels to alpha=0 with a soft edge near the threshold.

    Pixels where min(R,G,B) >= white_threshold become fully transparent.
    Pixels in the threshold-soft_edge band fade linearly to avoid harsh
    haloing at the brand-color / background-color boundary.
    """
    rgba = img.convert('RGBA')
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, _a = px[x, y]
            m = min(r, g, b)
            if m >= white_threshold:
                px[x, y] = (r, g, b, 0)
            elif m >= white_threshold - soft_edge:
                # linear ramp from full alpha at (threshold - soft_edge)
                # to zero alpha at (threshold)
                alpha = int(255 * (white_threshold - m) / soft_edge)
                px[x, y] = (r, g, b, alpha)
    return rgba


# ── Fidelis: tight bbox of FULL logo (mascot + banner), as PNG w/ alpha ──
img_f = Image.open(FIDELIS_SRC)
w_f, h_f = img_f.size
bbox_f = tight_bbox_rgb(img_f)
if bbox_f is None:
    raise SystemExit('Fidelis source is entirely white — refusing to crop')
fidelis_crop = img_f.crop(bbox_f)
fidelis_alpha = white_to_transparent(fidelis_crop)
fidelis_out = CARRIERS / 'fidelis-care-final.png'
fidelis_alpha.save(fidelis_out, format='PNG', optimize=True)
fw, fh = fidelis_alpha.size
print(f'Fidelis  source:  {w_f}x{h_f}')
print(f'Fidelis  bbox:    {bbox_f}')
print(f'Fidelis  output:  {fw}x{fh}  (ratio {fw/fh:.2f}:1)  -> {fidelis_out.name}')

# ── Wellcare: tight bbox of the circle, as PNG w/ alpha ──────────────────
img_w = Image.open(WELLCARE_SRC)
w_w, h_w = img_w.size
bbox_w = tight_bbox_rgb(img_w)
if bbox_w is None:
    raise SystemExit('Wellcare source is entirely white — refusing to crop')
wellcare_crop = img_w.crop(bbox_w)
wellcare_alpha = white_to_transparent(wellcare_crop)
wellcare_out = CARRIERS / 'wellcare-final.png'
wellcare_alpha.save(wellcare_out, format='PNG', optimize=True)
ww, wh = wellcare_alpha.size
print(f'Wellcare source: {w_w}x{h_w}')
print(f'Wellcare bbox:   {bbox_w}')
print(f'Wellcare output: {ww}x{wh}  (ratio {ww/wh:.2f}:1)  -> {wellcare_out.name}')
