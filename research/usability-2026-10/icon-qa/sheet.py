# PD-156 QA: лист размеров реальных PNG иконок (downscale из apple-touch-180 / icon-512, zoom nearest) + маски iOS и круг maskable.
import sys
from PIL import Image, ImageDraw
D='apps/web/public/icons/'
src180=Image.open(D+'apple-touch-icon-180.png').convert('RGB')
src512=Image.open(D+'icon-512.png').convert('RGB')
sizes=[29,32,60,87,120,180]
Z=5
W=sum(max(s*1,s)*1 for s in sizes)
sheet=Image.new('RGB',(1400,760),(235,235,240)); d=ImageDraw.Draw(sheet)
x=10
for s in sizes:
    im=src180.resize((s,s),Image.LANCZOS) if s<=180 else src180
    # iOS mask
    m=Image.new('L',(s*4,s*4),0); ImageDraw.Draw(m).rounded_rectangle([0,0,s*4-1,s*4-1],radius=int(s*4*0.2237),fill=255); m=m.resize((s,s),Image.LANCZOS)
    masked=Image.new('RGB',(s,s),(235,235,240)); masked.paste(im,(0,0),m)
    z=masked.resize((s*Z if s<100 else s*2, s*Z if s<100 else s*2),Image.NEAREST)
    sheet.paste(z,(x,10)); d.text((x,z.height+14),f'{s}px',fill=(0,0,0))
    x+=z.width+12
# maskable circle
c=Image.new('RGB',(512,512),(235,235,240)); mm=Image.new('L',(2048,2048),0); ImageDraw.Draw(mm).ellipse([0,0,2047,2047],fill=255)
mm=mm.resize((512,512),Image.LANCZOS)
# adaptive-circle crop at 100% (mask = circle through whole canvas) and safe-zone ring at 80 %
circ=Image.new('RGB',(512,512),(235,235,240)); circ.paste(src512,(0,0),mm)
dd=ImageDraw.Draw(circ); r=512*0.4; dd.ellipse([256-r,256-r,256+r,256+r],outline=(255,0,0),width=1)
sheet.paste(circ,(10,330)); d.text((10,845-90),'maskable circle (full-canvas mask) + red 80% safe zone',fill=(0,0,0))
sq=Image.new('RGB',(512,512),(235,235,240)); m=Image.new('L',(2048,2048),0); ImageDraw.Draw(m).rounded_rectangle([0,0,2047,2047],radius=int(2048*.2237),fill=255); m=m.resize((512,512),Image.LANCZOS); sq.paste(src512,(0,0),m)
sheet.paste(sq,(540,330))
sheet.save(sys.argv[1])
