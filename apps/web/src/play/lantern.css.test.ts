/**
 * PD-208/PD-210/PD-216: оформление Фонаря (styles/lantern.css), вариант C «Туман» глубины 2: в тени своя цифра и заметки размыты
 * настоящим blur от стороны клетки (--s) + прозрачность, одним filter на элемент. Осмотр b — `.is-peek`.
 * Reduce Motion — множитель `--mo` (tokens.css): переход света мгновенный. Подсказки не трогаются никогда.
 */
import { describe, expect, it } from "vitest";
import { FOG_FADE_MS } from "./lanternFade";

// vitest отдаёт пустую строку для `.css?raw`, а @types/node в этом пакете нет — читаем файл через динамический node:fs.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/lantern.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const main = fs.readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("lantern.css", () => {
  it("подключён в main.tsx", () => {
    expect(main).toContain('import "./styles/lantern.css";');
  });

  it("токены объявлены на .board.lantern", () => {
    for (const t of ["--lantern-blur", "--lantern-shade-a", "--lantern-peek-ink", "--lantern-ms"]) expect(css).toMatch(new RegExp(`${t}:`));
  });

  it("тень: один filter (blur от --s + opacity) на цифре и заметках; глубина 2 (≥ 11 % клетки, ≤ 32 %); без will-change; подсказки не трогаются", () => {
    // PD-251: класс — на слое тумана (`.d.player.fog` / `.marks.spot`), не на клетке: гаснущий туман в клетке на свету остаётся размытым.
    expect(css).toMatch(/\.board\.lantern \.cell \.d\.player\.fog,\s*\.board\.lantern \.cell \.marks\.spot \{\s*filter: blur\(calc\(var\(--s\) \* var\(--lantern-blur\)\)\) opacity\(var\(--lantern-shade-a\)\);/);
    expect(Number(/--lantern-blur: ([\d.]+);/.exec(css)?.[1])).toBeGreaterThanOrEqual(0.11);
    expect(Number(/--lantern-shade-a: ([\d.]+);/.exec(css)?.[1])).toBeLessThanOrEqual(0.32);
    expect(css).not.toMatch(/will-change/);
    expect(css).not.toMatch(/\.d\.given/);
    expect(css).toMatch(/@media print \{\s*\.board\.lantern \.cell \.d\.player\.fog,\s*\.board\.lantern \.cell \.marks\.spot,\s*\.board\.lantern \.cell \.fading \{\s*visibility: hidden;/);
  });

  it("PD-230: заметки в тени — одно пятно по центру клетки (размер от --s), тем же filter; ни сетки 3×3, ни правил по цифре", () => {
    const rule = /(?<!,\s*)\.board\.lantern \.cell \.marks\.spot \{([^}]*)\}/.exec(css)?.[1] ?? ""; // своё правило, не список с туманом цифры
    expect(rule).toMatch(/display: grid;/);
    expect(rule).toMatch(/grid-template: 1fr \/ 1fr;/); // одна ячейка, не 3×3 `.marks`
    expect(rule).toMatch(/place-items: center;/);
    expect(rule).toMatch(/padding: 0;/);
    const dot = /\.board\.lantern \.cell \.marks\.spot::before \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(dot).toMatch(/width: calc\(var\(--s\) \* var\(--lantern-spot\)\);/);
    expect(dot).toMatch(/height: calc\(var\(--s\) \* var\(--lantern-spot\)\);/);
    expect(dot).toMatch(/background: color-mix\(in srgb, var\(--notes\) var\(--lantern-spot-a\), transparent\);/);
    expect(Number(/--lantern-spot: ([\d.]+);/.exec(css)?.[1])).toBeGreaterThan(0.1);
    // Ничего не зависит от позиции/цифры заметки: ни nth-child, ни struck, ни сеток в тени.
    expect(css).not.toMatch(/is-shadow[^{]*(nth-child|struck|span)/);
    expect(css).not.toMatch(/\.spot[^{]*(nth-child|struck|span)/);
    expect(css).toMatch(/@media \(forced-colors: active\) \{\s*\.board\.lantern \.cell \.marks\.spot::before \{\s*forced-color-adjust: none;/);
  });

  it("осмотр b: своя цифра тени — чернила с долей ≥ 80 % (контраст ≥ 4.5:1) и ореол", () => {
    const m = /--lantern-peek-ink: (\d+)%;/.exec(css);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(80);
    expect(css).toMatch(/\.board\.lantern \.cell \.d\.player\.pk:not\(\.err\) \{[^}]*text-shadow/); // PD-251: класс на слое
  });

  it("Reduce Motion: все переходы света умножены на --mo (мгновенно при «Уменьшении движения»)", () => {
    const transitions = css.match(/transition:[^;]+;/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) {
      expect(t).toContain("* var(--mo)");
      expect(t).not.toMatch(/filter/); // blur не анимируется
    }
    expect(css).not.toMatch(/prefers-reduced-motion/);
    expect(css).not.toMatch(/animation:/);
  });

  it("PD-251: кроссфейд тумана — анимируется только opacity слоя (blur — никогда), 150–250 мс = FOG_FADE_MS, гаснущий слой → 0", () => {
    // Все переходы и свойства перехода в файле — только opacity.
    const transitions = css.match(/transition(-property)?:[^;]+;/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) expect(t).toMatch(/^transition(-property)?: opacity\b/);
    expect(css).not.toMatch(/transition:\s*all/);
    const ms = Number(/--lantern-ms: (\d+)ms;/.exec(css)?.[1]);
    expect(ms).toBeGreaterThanOrEqual(150);
    expect(ms).toBeLessThanOrEqual(250);
    expect(ms).toBe(FOG_FADE_MS);
    // Новый слой — от 0 (@starting-style), прежний — `.fading` гаснет до 0 (ease-out: чёткая цифра уходит быстрее).
    expect(css).toMatch(/@starting-style \{\s*\.board\.lantern \.cell \.d\.player,\s*\.board\.lantern \.cell \.marks \{\s*opacity: 0;/);
    const fading = /\.board\.lantern \.cell \.d\.player\.fading,\s*\.board\.lantern \.cell \.marks\.fading \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(fading).toMatch(/opacity: 0;/);
    expect(fading).toMatch(/transition-timing-function: var\(--e-out\);/);
    expect(fading).not.toMatch(/filter|transform/);
    // Слои цифры стоят в одной ячейке сетки клетки — второй слой не сдвигает первый.
    expect(css).toMatch(/\.board\.lantern \.cell > \.d \{\s*grid-area: 1 \/ 1;/);
    // Blur не зависит от времени: radius — только в правиле тумана, нигде не в transition/@keyframes.
    expect(css.match(/blur\(/g)).toHaveLength(1);
    expect(css).not.toMatch(/@keyframes/);
  });

  it("строка статуса: зазор — size-контейнер, AX3 — короткая форма, у «Готово» 44 px", () => {
    expect(css).toMatch(/\.gap:has\(> \.lantern-status\) \{\s*container-type: size;/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.status\.lantern-status > \.ls-short \{\s*display: block;/);
    expect(css).toMatch(/\.ls-done \{[^}]*min-height: 44px;/);
  });
});
