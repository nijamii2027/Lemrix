"""Slice and align the generated comic artwork for the storefront and site."""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("lemrix")
parser.add_argument("cookd")
parser.add_argument("spots")
parser.add_argument("storefront")
args = parser.parse_args()
output = Path(__file__).resolve().parents[1] / "dist/assets/comic"
output.mkdir(parents=True, exist_ok=True)

def trim(image):
    """Use the silhouette for the crop without changing its alpha."""
    bounds = image.getchannel("A").point(lambda a: 255 if a >= 16 else 0).getbbox()
    if not bounds:
        raise ValueError("The atlas contains an empty cell.")
    x1, y1, x2, y2 = bounds
    return image.crop((max(0, x1-3), max(0, y1-3), min(image.width, x2+3), min(image.height, y2+3)))

def save(image, name, quality=92):
    image.save(output / (name + ".webp"), quality=quality, method=6)

def foot_center(image):
    alpha = np.asarray(image.getchannel("A"))
    _, columns = np.nonzero(alpha[round(image.height * .80):] > 110)
    return float(np.median(columns)) if columns.size else image.width / 2

def align(pose, scale, width, height, baseline):
    """Keep the feet on one shared contact line as the frames change."""
    size = (round(pose.width * scale), round(pose.height * scale))
    resized = pose.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (width, height))
    x = round(width / 2 - foot_center(pose) * scale)
    x = min(max(x, 3), width - size[0] - 3)
    canvas.paste(resized, (x, baseline - size[1]))
    return canvas

def sprites(name, source, flip_run=False):
    sheet = Image.open(source).convert("RGBA")
    poses = []
    for index in range(6):
        col, row = index % 3, index // 3
        pose = trim(sheet.crop((
            round(col * sheet.width / 3), round(row * sheet.height / 2),
            round((col + 1) * sheet.width / 3), round((row + 1) * sheet.height / 2)
        )))
        poses.append(ImageOps.mirror(pose) if flip_run and 1 <= index <= 4 else pose)
    width, height = 400, 420
    scale = min(384 / max(p.height for p in poses), 388 / max(p.width for p in poses))
    aligned = [align(pose, scale, width, height, 410) for pose in poses]
    atlas = Image.new("RGBA", (width * len(aligned), height))
    for index, cel in enumerate(aligned):
        atlas.paste(cel, (index * width, 0))
    save(atlas, name + "-poses", 91)
    save(aligned[0], name + "-idle")
    trail = Image.new("RGBA", (128 * 12, 160))
    trail_frames = [align(pose, scale * .31, 128, 160, 154) for pose in poses]
    for index in range(12):
        trail.paste(trail_frames[1 + index % 4], (index * 128, 0))
    save(trail, name + "-trail")
    save(trail_frames[0], name + "-trail-idle")

sprites("lemrix", args.lemrix, flip_run=True)
sprites("cookd", args.cookd)
save(Image.open(args.storefront).convert("RGBA"), "storefront", 94)

sheet = Image.open(args.spots).convert("RGBA")
# Wide gutters separate the four complete illustrations.
mid_y = sheet.height // 2
split_x = round(sheet.width * .478)
save(trim(sheet.crop((0, 0, split_x, mid_y))), "card-show")
save(trim(sheet.crop((0, mid_y, sheet.width // 2, sheet.height))), "binder-lemrix")
save(trim(sheet.crop((sheet.width // 2, mid_y, sheet.width, sheet.height))), "lucky-cookd")

duo = sheet.crop((split_x, 0, sheet.width, mid_y))
save(trim(duo), "midnight-service")
# The pancake and its motion marks are separate islands in the atlas.
# Extract the pancake layer for the kitchen animation. Preserve the
# characters and the original transparency around their silhouettes.
alpha = np.asarray(duo.getchannel("A"))
labels, count = ndimage.label(alpha > 14)
components = ndimage.find_objects(labels)
pancake_id = labels[155, 895 - split_x]
if not pancake_id:
    raise ValueError("Could not locate the pancake layer in the kitchen illustration.")
pancake = labels == pancake_id
pancake_edge = ndimage.binary_dilation(pancake, iterations=2)
pancake_rgba = np.asarray(duo).copy()
pancake_rgba[:, :, 3] = np.where(pancake_edge, alpha, 0)
save(trim(Image.fromarray(pancake_rgba)), "pancake")

removed = pancake_edge.copy()
for index, bounds in enumerate(components, start=1):
    if not bounds or index == pancake_id:
        continue
    y, x = bounds
    if x.start + split_x >= 930 and x.stop + split_x <= 985 and y.start >= 180 and y.stop <= 235:
        removed |= ndimage.binary_dilation(labels == index, iterations=2)
base = np.asarray(duo).copy()
base[:, :, 3] = np.where(removed, 0, alpha)
kitchen = Image.fromarray(base)
bounds = kitchen.getchannel("A").point(lambda a: 255 if a >= 16 else 0).getbbox()
kitchen = kitchen.crop(bounds)
scale = min(580 / kitchen.width, 345 / kitchen.height)
size = (round(kitchen.width * scale), round(kitchen.height * scale))
left, top = (640 - size[0]) // 2, 384 - size[1]
composition = Image.new("RGBA", (640, 405))
composition.paste(kitchen.resize(size, Image.Resampling.LANCZOS), (left, top))
save(composition, "kitchen-duo")
pan_x = (left + (929 - split_x - bounds[0]) * scale) / 640 * 100
pan_y = (top + (275 - bounds[1]) * scale) / 405 * 100
print(f"Kitchen pan center: {pan_x:.2f}% / {pan_y:.2f}%")
print("Packed two six-pose mascots, four spot illustrations and the kitchen layers.")
