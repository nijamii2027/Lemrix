from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from base64 import b64encode
root=Path(__file__).parent
out=root/'dist/rewards';out.mkdir(exist_ok=True)
f=TTFont(root/'dist/assets/Caprasimo-Regular.ttf');glyphs=f.getGlyphSet();cmap=f.getBestCmap();upm=f['head'].unitsPerEm
INK='#182359';PAPER='#faf2df';BUTTER='#f8e8c8';GOLD='#f8d77d'
def text(t,x,y,size,fill=INK,maxwidth=None):
 names=[cmap.get(ord(c),'.notdef') for c in t];width=sum(glyphs[n].width for n in names)
 if maxwidth:size=min(size,maxwidth*upm/width)
 pen=SVGPathPen(glyphs);cursor=0
 for n in names:glyphs[n].draw(TransformPen(pen,(1,0,0,1,cursor,0)));cursor+=glyphs[n].width
 return f'<path d="{pen.getCommands()}" fill="{fill}" transform="translate({x} {y}) scale({size/upm} {-size/upm})"/>'
def star(x,y,r,fill=GOLD):return f'<path d="M{x} {y-r}Q{x+r*.12} {y-r*.1} {x+r} {y}Q{x+r*.12} {y+r*.1} {x} {y+r}Q{x-r*.12} {y+r*.1} {x-r} {y}Q{x-r*.12} {y-r*.1} {x} {y-r}Z" fill="{fill}"/>'
def svg(w,h,c,bg):return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><rect width="100%" height="100%" fill="{bg}"/>{c}</svg>'
phone=f'<path d="M830 310a150 150 0 1 0 135 230A150 150 0 0 1 830 310Z" fill="{BUTTER}"/>'
for x,y,r in [(190,340,20),(410,570,10),(960,960,16),(230,1550,13),(880,2180,22)]:phone+=star(x,y,r)
phone+=text('One more',105,1250,190,BUTTER,960)+text('pack?',105,1535,280,BUTTER,960)+text('Lemrix TCG',110,2310,60,BUTTER,950)
(out/'blue-hour-phone.svg').write_text(svg(1170,2532,phone,INK))
desk=f'<path d="M1480 170a155 155 0 1 0 145 245A155 155 0 0 1 1480 170Z" fill="{BUTTER}"/>'
for x,y,r in [(1510,650,22),(1740,530,13),(1280,850,18),(210,170,12),(1700,140,10)]:desk+=star(x,y,r)
desk+=text('One more',130,470,220,BUTTER,1140)+text('pack?',130,740,260,BUTTER,1000)+text('Lemrix TCG',137,975,47,BUTTER)
(out/'desk-drop.svg').write_text(svg(1920,1080,desk,INK))
labels=text('The card cabinet.',55,105,60,INK,720)+text('Lemrix TCG / Binder labels',55,155,24,INK,730)
for i,t in enumerate(['The keepers','Japanese','Anniversary','Alternate art','The wishlist','To trade','The favourites','New additions']):
 x=55+(i%2)*375;y=210+(i//2)*215
 labels+=f'<rect x="{x}" y="{y}" width="350" height="180" rx="15" fill="{PAPER}" stroke="#a1a3a8" stroke-dasharray="6 5"/>'
 labels+=text(t,x+18,y+61,34,INK,310)+f'<path d="M{x+18} {y+112}h310M{x+18} {y+147}h310" stroke="#b0b2b8"/>'
labels+=text('Print at actual size. Cut along the guides.',55,1135,20,INK,730)
(out/'binder-labels.svg').write_text(svg(840,1188,labels,'#fff').replace('width="840" height="1188"','width="210mm" height="297mm"'))
(out/'collector-notes.csv').write_text('Card name,Set,Card number,Language,Condition,Grading company,Grade,Certification number,Acquired date,Quantity,Notes\n')
print('Four rewards regenerated in current brand typography and palette.')
