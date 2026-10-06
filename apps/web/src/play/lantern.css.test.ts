/**
 * PD-208/PD-210: оформление Фонаря (styles/lantern.css), вариант C «Туман» глубины 2: в тени вместо своей цифры/заметок — пятно
 * (градиент фона, без filter: blur и без текста), размер — в em шрифта цифры (масштабируется с полем). Осмотр b — `.is-peek`.
 * Reduce Motion — множитель `--mo` (tokens.css): переход света мгновенный. Подсказки не трогаются никогда.
 */
import { describe, expect, it } from "vitest";

// vitest отдаёт пустую строку для `.css?raw`, а @types/node в этом пакете нет — читаем файл через динамический node:fs.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/lantern.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const main = fs.readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("lantern.css", () => {
  it("подключён в main.tsx", () => {
    expect(main).toContain('import "./styles/lantern.css";');
  });

  it("токены объявлены на .board.lantern", () => {
    for (const t of ["--lantern-fog-w", "--lantern-fog-h", "--lantern-fog-a", "--lantern-notes-r", "--lantern-notes-a", "--lantern-peek-ink", "--lantern-ms"]) {
      expect(css).toMatch(new RegExp(`${t}:`));
    }
  });

  it("туман — градиент в em (от шрифта цифры), без filter/backdrop-filter/will-change; подсказки (.d.given) не трогаются", () => {
    expect(css).toMatch(/\.d\.fog \{[^}]*width: var\(--lantern-fog-w\);[^}]*radial-gradient/);
    expect(css).toMatch(/--lantern-fog-w: [\d.]+em;/);
    expect(css).toMatch(/\.marks\.fog \{[^}]*radial-gradient/);
    expect(css).not.toMatch(/filter\s*:/);
    expect(css).not.toMatch(/will-change/);
    expect(css).not.toMatch(/\.d\.given/);
  });

  it("осмотр b: своя цифра тени — чернила с долей ≥ 80 % (контраст ≥ 4.5:1) и ореол", () => {
    const m = /--lantern-peek-ink: (\d+)%;/.exec(css);
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(80);
    expect(css).toMatch(/\.cell\.is-peek \.d\.player:not\(\.err\) \{[^}]*text-shadow/);
  });

  it("Reduce Motion: все переходы света умножены на --mo (мгновенно при «Уменьшении движения»)", () => {
    const transitions = css.match(/transition:[^;]+;/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) expect(t).toContain("* var(--mo)");
    expect(css).not.toMatch(/prefers-reduced-motion/);
    expect(css).not.toMatch(/animation:/);
  });

  it("строка статуса: зазор — size-контейнер, AX3 — короткая форма, у «Готово» 44 px", () => {
    expect(css).toMatch(/\.gap:has\(> \.lantern-status\) \{\s*container-type: size;/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.status\.lantern-status > \.ls-short \{\s*display: block;/);
    expect(css).toMatch(/\.ls-done \{[^}]*min-height: 44px;/);
  });
});
