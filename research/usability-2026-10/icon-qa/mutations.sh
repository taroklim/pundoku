cd "$(dirname "$0")/../../../apps/web"
T="scripts/icons.test.mjs src/brand/brand.test.tsx src/styles/brand.css.test.ts src/recovery/SettingsScreen.test.tsx src/play/fingerprint.mark.test.ts src/year/YearScreen.test.tsx"
run() { pnpm exec vitest run $T --testTimeout=120000 --maxWorkers=3 2>&1 | grep -E "Tests  |Test Files" | tr '\n' ' '; echo; }
mut() { echo "== $1"; shift; "$@"; git diff --stat | tail -1; run; git checkout -q -- . ; }
echo "== baseline"; run
mut "M1 pattern: counter filled (10 cells)" sed -i '' 's|"XXX", "X.X", "XXX", "X.."|"XXX", "XXX", "XXX", "X.."|' src/brand/markPaths.ts
mut "M2 full coord 272->273" sed -i '' 's|{ x: 272, y: 189 }|{ x: 273, y: 189 }|' src/brand/markPaths.ts
mut "M3 ICON_VERSION p5 (html still p4)" sed -i '' 's|ICON_VERSION = "p4"|ICON_VERSION = "p5"|' pwa.config.ts
mut "M4 drop maskable entry" sed -i '' '/purpose: "maskable"/d' pwa.config.ts
mut "M5 icon.svg first rect x 3->4" sed -i '' '0,/x="3" y="1"/s//x="4" y="1"/' public/icons/icon.svg
mut "M6 icon-512.png replaced by D5" cp ../../design/pd98-assets/shipped-d5/icon-512.png public/icons/icon-512.png
mut "M7 index.html: drop favicon-16 link" sed -i '' '/favicon-16.png?v=p4/d' index.html
mut "M8 ICON_VERSION back to d5 in both" sh -c "sed -i '' 's|ICON_VERSION = \"p4\"|ICON_VERSION = \"d5\"|' pwa.config.ts; sed -i '' 's|?v=p4|?v=d5|g' index.html"
mut "M9 solid favicon path counter removed" sed -i '' 's|+ "M6 4V7H11V4Z"|+ ""|' src/brand/markPaths.ts
mut "M10 forced-colors rule removed" python3 -c "
p='src/styles/brand.css';s=open(p).read();s=s.replace('''  .brand-mark rect,
  .brand-mark path {
    fill: CanvasText;
  }''','',1);open(p,'w').write(s)"
git status --short
