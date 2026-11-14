"""Pack transparent cels and real highlight frames for the browser sprite clock."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("render", type=Path)
parser.add_argument("lemrix", type=Path)
parser.add_argument("cookd", type=Path)
parser.add_argument("--assets", type=Path, default=Path("dist/assets/scenes"))
args = parser.parse_args()
assets = args.assets
size = (1200, 850)
stage = Image.open(args.render / "tv-render.png").convert("RGBA")
stage.save(assets / "crt-diorama.webp", quality=90, method=6)
projection = json.loads((args.render / "tv-projection.json").read_text())

actors = []
for name, path, shifts, display_height in (
    ("lemrix", args.lemrix, (0, 0, 0), 292),
    ("cookd", args.cookd, (-40, 0, 48), 282),
):
    image = Image.open(path).convert("RGBA")
    image.putalpha(image.getchannel("A").point(lambda value: 0 if value < 36 else value))
    frame_width = image.width // 3
    strip = Image.new("RGBA", (1080, 360))
    for index, shift in enumerate(shifts):
        frame = image.crop((index * frame_width, 0, (index+1)*frame_width, image.height))
        frame.thumbnail((360,360),Image.Resampling.LANCZOS)
        strip.alpha_composite(frame, (index*360+(360-frame.width)//2+round(shift*frame.width/frame_width),360-frame.height))
    strip.save(assets / f"crt-{name}.webp", quality=88, method=6)
    actors.append({"anchor":projection["actors"][len(actors)],"size":display_height})

frame_width, frame_height = 224, 152
columns, rows = 8, 4
with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp)
    subprocess.run(["ffmpeg","-v","error","-i",str(assets/"lemrix-highlights.mp4"),
                    "-vf",f"fps=16,scale={frame_width}:{frame_height}",
                    "-frames:v","64",str(tmp/"%03d.png")],check=True)
    paths = sorted(tmp.glob("*.png"))
    paths += [paths[-1]] * (64-len(paths))
    for offset in (0, 32):
        sheet = Image.new("RGB", (columns*frame_width,rows*frame_height))
        for index, path in enumerate(paths[offset:offset+32]):
            with Image.open(path) as frame:
                sheet.paste(frame,(index%columns*frame_width,index//columns*frame_height))
        sheet.save(assets/f"crt-footage-{offset//32}.webp",quality=78,method=6)

    # Compose the same opening frame for a readable no-script fallback.
    top_left, top_right, bottom_left = projection["screen"]
    ax, ay = ((b-a)/frame_width for a,b in zip(top_left,top_right))
    bx, by = ((b-a)/frame_height for a,b in zip(top_left,bottom_left))
    det = ax*by-ay*bx
    a,b,d,e = by/det,-bx/det,-ay/det,ax/det
    tx,ty=top_left
    mask = Image.new("L",(frame_width,frame_height))
    ImageDraw.Draw(mask).rounded_rectangle((0,0,frame_width-1,frame_height-1),radius=15,fill=255)
    with Image.open(paths[0]) as original:
        frame = original.convert("RGBA")
        frame.putalpha(mask)
        film = frame.transform(size,Image.Transform.AFFINE,(a,b,-a*tx-b*ty,d,e,-d*tx-e*ty),Image.Resampling.BICUBIC)
        stage.alpha_composite(film)
    for name, actor in zip(("lemrix","cookd"),actors):
        sprite = Image.open(assets/f"crt-{name}.webp").crop((0,0,360,360)).resize((actor["size"],)*2,Image.Resampling.LANCZOS)
        x,y = actor["anchor"]
        stage.alpha_composite(sprite,(round(x-actor["size"]/2),round(y-actor["size"]*.96)))
    stage.save(assets/"crt-poster.webp",quality=89,method=6)

(assets/"crt-scene.json").write_text(json.dumps({"screen":projection["screen"],"actors":actors})+"\n")
