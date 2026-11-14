"""Package native 3D renders without changing their outlines or alpha."""
import json
import sys
from pathlib import Path
from PIL import Image

work=Path(sys.argv[1])
destination=Path(__file__).resolve().parents[1]/"dist/assets/opening/hero"
destination.mkdir(parents=True,exist_ok=True)
def pack_hands():
    for name,offset in [("lemrix",0),("cookd",16)]:
        atlas=Image.new("RGBA",(800*4,248*4))
        for index in range(16):
            atlas.paste(Image.open(work/f"hand-{index+offset:02}.png"),((index%4)*800,(index//4)*248))
        atlas.save(destination/f"hand-{name}.webp",quality=94,method=6)
    print("Packed both transparent hand animations.")

if "hands" in sys.argv:
    pack_hands()
    sys.exit(0)
data=json.loads((work/"hero.json").read_text())
if "animation" not in sys.argv and "hands" not in sys.argv:
    for name in ["poster","backdrop"]:
        Image.open(work/f"{name}.png").save(destination/f"{name}.webp",quality=92,method=6)
if "static" in sys.argv:
    sys.exit(0)
frame=Image.open(work/"frame-000.png")
width,height=frame.size
count=len(data["frames"])
if "hands" not in sys.argv:
    for sheet in range((count+31)//32):
        atlas=Image.new("RGBA",(width*8,height*4))
        for position in range(32):
            index=sheet*32+position
            if index>=count:
                break
            atlas.paste(Image.open(work/f"frame-{index:03}.png"),((position%8)*width,(position//8)*height))
        atlas.save(destination/f"mascots-{sheet}.webp",quality=90,method=6)
pack_hands()
manifest={"width":data["width"],"height":data["height"],"left":data["crop"]["left"],
 "top":data["crop"]["top"],"frameWidth":width,"frameHeight":height,"columns":8,
 "framesPerSheet":32,"frameCount":count,"fps":count/8}
(destination/"animation.json").write_text(json.dumps(manifest,indent=2)+"\n")
print(json.dumps(manifest))
