"""
Extract "wellcare" wordmark from the circular logo source.

Source: Desktop/wellcare_Logo.jpg (1560x816, teal circle with white "wellcare"
text inside).

Goal: Produce a horizontal-rectangle PNG containing ONLY the "wellcare"
wordmark in teal color on transparent background. This matches the visual
rhythm of the other carrier wordmarks (Aetna, Anthem, Humana, etc.) so
Wellcare no longer looks like an "orphan" circle in the carrier grid.

Approach:
  1. Open source.
  2. White pixels (the wordmark text) -> teal color on opaque.
  3. Teal pixels (circle background) -> transparent.
  4. Everything else (anti-aliased edges, outer white canvas) -> handled
     proportionally via min(R,G,B) detection.
  5. Crop tightly to the non-transparent bounding box.

Writes: public/carriers/wellcare-wordmark.png (NEW — does not overwrite
the existing wellcare-final.png so Sawil can compare).
"""
from PIL import Image
from pathlib import Path
import numpy as np

DESKTOP = Path.home() / 'OneDrive' / 'Desktop'
SRC = DESKTOP / 'wellcare_Logo.jpg'
OUT = Path(__file__).resolve().parents[1] / 'public' / 'carriers' / 'wellcare-wordmark.png'

# Brand teal sampled from the source circle. Wellcare brand teal is roughly
# RGB(34, 158, 159) — verified by inspection of the source.
TEAL = (34, 158, 159)

img = Image.open(SRC).convert('RGBA')
arr = np.array(img)
r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]

# Detect what each pixel is:
#  • white text:   R, G, B all very high
#  • teal circle:  R low, G & B moderate-to-high, G ~ B
#  • outer white:  same RGB as text but OUTSIDE the circle — we filter this
#                  by also checking that the pixel was originally inside
#                  the teal-dominant region.

# Step 1: detect white-ish pixels (the wordmark text + the small TM mark)
white_pixels = (r > 230) & (g > 230) & (b > 230)

# Step 2: detect teal-circle-interior pixels. The CIRCLE EDGE is also teal,
# but we want to exclude the edge. Trick: a pixel that's in the interior of
# the circle has many teal neighbors in all directions. Pixels on the edge
# have teal on one side and white/transparent on the other.
# Approach: use connected-component on teal pixels and keep only the LARGEST
# component (which is the solid filled circle, not the outer perimeter
# anti-aliasing artifacts).
teal_pixels = (r < 110) & (g > 110) & (b > 110) & (np.abs(g.astype(int) - b.astype(int)) < 80)

# Step 3: find connected components of teal pixels; keep the largest
from scipy.ndimage import label as cc_label
teal_labels, n_teal = cc_label(teal_pixels)
if n_teal == 0:
    raise SystemExit('No teal circle detected')
sizes = np.bincount(teal_labels.ravel())
sizes[0] = 0  # background
largest_teal_label = sizes.argmax()
circle_mask = teal_labels == largest_teal_label

# Step 4: text is white pixels that are ALSO inside the circle's filled
# region. To get "inside" reliably, we use the bounding box of the largest
# teal component AND require white pixels to be away from the edge by some
# margin (kills both circle-perimeter ring and any white outside the circle).
ys_c, xs_c = np.where(circle_mask)
cy_min, cy_max = ys_c.min(), ys_c.max()
cx_min, cx_max = xs_c.min(), xs_c.max()
circle_h = cy_max - cy_min
circle_w = cx_max - cx_min
# Pull bounding box inward by 8% on each side — kills the circle outline ring
margin_y = int(circle_h * 0.08)
margin_x = int(circle_w * 0.08)
inner_bbox_mask = np.zeros_like(circle_mask)
inner_bbox_mask[cy_min + margin_y : cy_max - margin_y,
                cx_min + margin_x : cx_max - margin_x] = True
text_mask = white_pixels & inner_bbox_mask

# Step 5: each letter of "wellcare" is a SEPARATE connected component in
# the source. To keep the whole wordmark, we keep all components whose Y
# centroid is on the same row as the LARGEST component. The TM trademark
# (at the bottom-right of the circle) and any circle-outline artifacts (at
# the top/bottom of the circle) have very different Y centroids and get
# dropped.
text_labels, n_text = cc_label(text_mask)
if n_text > 0:
    text_sizes = np.bincount(text_labels.ravel())
    text_sizes[0] = 0  # exclude background

    # Compute Y centroid of every component (weighted by pixel count)
    from scipy.ndimage import center_of_mass
    centroids = center_of_mass(text_mask, text_labels, range(1, n_text + 1))
    centroid_ys = np.array([c[0] for c in centroids])  # shape (n_text,)

    # Find the Y of the LARGEST component (the most-filled letter)
    biggest_label = text_sizes.argmax()
    biggest_y = centroids[biggest_label - 1][0]  # centroids is 0-indexed for label 1+

    # Keep components whose Y centroid is within 50px of the largest's Y
    # AND whose size is at least 1000 pixels (kills the TM and tiny artifacts)
    y_tolerance = 50
    min_size = 1000
    kept_labels = []
    for i in range(1, n_text + 1):
        cy = centroids[i - 1][0]
        size = text_sizes[i]
        if abs(cy - biggest_y) <= y_tolerance and size >= min_size:
            kept_labels.append(i)

    text_mask = np.isin(text_labels, kept_labels)
    print(f'Kept {len(kept_labels)} of {n_text} components '
          f'(Y centroid within {y_tolerance}px of largest, size >= {min_size}px). '
          f'Total mask pixels: {text_mask.sum()}')

# Step 6: build the new output array — all transparent by default
out_arr = np.zeros((arr.shape[0], arr.shape[1], 4), dtype=np.uint8)
out_arr[text_mask, 0] = TEAL[0]
out_arr[text_mask, 1] = TEAL[1]
out_arr[text_mask, 2] = TEAL[2]
out_arr[text_mask, 3] = 255

# Step 7: tight bounding box around remaining text
ys, xs = np.where(text_mask)
if len(ys) == 0:
    raise SystemExit('No wordmark pixels detected after filtering')
top, bottom = ys.min(), ys.max()
left, right = xs.min(), xs.max()
pad_y = max(4, int((bottom - top) * 0.12))
pad_x = max(4, int((right - left) * 0.04))
top = max(0, top - pad_y)
bottom = min(arr.shape[0], bottom + pad_y)
left = max(0, left - pad_x)
right = min(arr.shape[1], right + pad_x)

cropped = out_arr[top:bottom, left:right]
result = Image.fromarray(cropped, 'RGBA')
result.save(OUT, format='PNG', optimize=True)
print(f'Source: {arr.shape[1]}x{arr.shape[0]}')
print(f'Text mask pixels: {text_mask.sum()}')
print(f'Bbox: left={left} top={top} right={right} bottom={bottom}')
print(f'Output: {cropped.shape[1]}x{cropped.shape[0]} (ratio {cropped.shape[1]/cropped.shape[0]:.2f}:1)')
print(f'Saved: {OUT}')
