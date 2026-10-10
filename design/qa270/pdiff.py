import sys, os, glob
from PIL import Image, ImageChops
br = sys.argv[1]
tot=0; bad=0
for f in sorted(glob.glob(f"/tmp/qa270/phone/new/{br}-*.png")):
    g = f.replace("/new/","/"+(sys.argv[2] if len(sys.argv)>2 else "base")+"/")
    if not os.path.exists(g): print("MISSING base", f); continue
    a=Image.open(f).convert("RGB"); b=Image.open(g).convert("RGB")
    tot+=1
    if a.size!=b.size: print("SIZE", os.path.basename(f), a.size, b.size); bad+=1; continue
    d=ImageChops.difference(a,b).getbbox()
    if d:
        n=sum(1 for p in ImageChops.difference(a,b).convert("L").getdata() if p>0)
        print("DIFF", os.path.basename(f), n, "px bbox", d); bad+=1
print(f"{tot-bad}/{tot} identical")
