cd /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku-worktrees/pd-logo5-qa/apps/web
T="src/brand/brand.test.tsx src/styles/brand.css.test.ts src/recovery/SettingsScreen.test.tsx src/play/fingerprint.mark.test.ts"
run() { pnpm exec vitest run $T --testTimeout=120000 --maxWorkers=3 2>&1 | grep -E "Tests |Test Files|^ *(FAIL|×)" | head -8; }
mut() { echo "== $1"; shift; "$@"; git diff --stat | tail -1; run; git checkout -q -- src; }
echo "== baseline"; run
mut "M1 rect count n" sed -i '' 's|rows: \["###", "#.#", "#.#"\] }|rows: ["###", "#.#", "#.."] }|' src/brand/wordmarkGeometry.ts
mut "M1b coords shift +1 in P" sed -i '' 's|{ name: "P", x: 0,|{ name: "P", x: 1,|' src/brand/wordmarkGeometry.ts
mut "M2 aria-label default" sed -i '' 's|export const WORDMARK_NAME = "Pundoku";|export const WORDMARK_NAME = "Pundoku Sudoku";|' src/brand/Wordmark.tsx
mut "M2b i18n en about.name" sed -i '' '34s|"name": "Pundoku"|"name": "Sudoku"|' src/i18n/locales/en.json
mut "M3a brand.css rect rule (forced)" python3 -c "
import re;p='src/styles/brand.css';s=open(p).read();s=s.replace('''  .wordmark rect {
    fill: CanvasText;
  }''','',1);open(p,'w').write(s)"
mut "M3b settings.css rect rule" python3 -c "
p='src/styles/settings.css';s=open(p).read();s=s.replace('''  .settings-about-word rect {
    fill: CanvasText;
  }''','',1);open(p,'w').write(s)"
mut "M3c both rect rules" python3 -c "
p='src/styles/settings.css';s=open(p).read();s=s.replace('''  .settings-about-word rect {
    fill: CanvasText;
  }''','',1);open(p,'w').write(s)
p='src/styles/brand.css';s=open(p).read();s=s.replace('''  .wordmark rect {
    fill: CanvasText;
  }''','',1);open(p,'w').write(s)"
mut "M4 remove aria-hidden on cells group" sed -i '' 's|<g aria-hidden="true" transform|<g transform|' src/brand/Wordmark.tsx
mut "M5 PNG wordmark colour (label->ink)" sed -i '' 's|ctx.fillStyle = FP_COLORS.label;\n  for|X|' src/play/fingerprint.ts
mut "M6 remove brand.css import in main.tsx" sed -i '' '/styles\/brand.css/d' src/main.tsx
git status --short
