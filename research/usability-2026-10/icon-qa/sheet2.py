# PD-156 QA: 58/87/120 px (реальные размеры iPhone-слотов 29/40 pt @2x/@3x) из apple-touch-180 и 24/32/48 из favicon-32, zoom nearest
from PIL import Image
D='apps/web/public/icons/'
s180=Image.open(D+'apple-touch-icon-180.png').convert('RGB')
f32=Image.open(D+'favicon-32.png').convert('RGBA'); f16=Image.open(D+'favicon-16.png').convert('RGBA')
sheet=Image.new('RGB',(1300,520),(242,242,247))
x=10
for s in (58,87,120):
    im=s180.resize((s,s),Image.LANCZOS); sheet.paste(im.resize((s*3,s*3),Image.NEAREST),(x,10)); x+=s*3+10
x=10
for bgc in ((255,255,255),(32,33,36)):
    for nm,im in (('16',f16),('32',f32)):
        t=Image.new('RGB',(32,32),bgc); t.paste(im,(0,0),im); sheet.paste(t.resize((256,256),Image.NEAREST),(x,370 if False else 380-0)) if False else None
sheet.save('/tmp/iconqa/s2.png')
# favicon strip: 16/32 on white and dark at 8x/6x
strip=Image.new('RGB',(1000,300),(255,255,255))
from PIL import ImageDraw
x=10
for bgc in ((255,255,255),(32,33,36)):
    for nm,im,z in (('16',f16,10),('32',f32,6)):
        t=Image.new('RGB',im.size,bgc); t.paste(im,(0,0),im); strip.paste(t.resize((im.width*z,im.height*z),Image.NEAREST),(x,10)); 
        x+=im.width*z+10
    
strip.save('/tmp/iconqa/fav.png')
sheet.save('/tmp/iconqa/s2.png')
