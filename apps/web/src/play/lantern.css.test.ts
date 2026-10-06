/**
 * PD-208: основа оформления Фонаря (styles/lantern.css) — только токены `--lantern-*` и классы `.is-lit`/`.is-shadow`, чтобы PD-210
 * перекрасил без правки разметки. Reduce Motion — множитель `--mo` (tokens.css): переход света мгновенный. Подсказки не
 * приглушаются никогда.
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

  it("токены перекраски объявлены на .board.lantern", () => {
    for (const t of ["--lantern-shadow-opacity", "--lantern-shadow-notes-opacity", "--lantern-shadow-bg", "--lantern-lit-bg", "--lantern-ms"]) {
      expect(css).toMatch(new RegExp(`${t}:`));
    }
  });

  it("в тени приглушаются только свои цифры и заметки — через токены; подсказки (.d.given) не трогаются", () => {
    expect(css).toMatch(/\.cell\.is-shadow \.d\.player \{\s*opacity: var\(--lantern-shadow-opacity\);/);
    expect(css).toMatch(/\.cell\.is-shadow \.marks \{\s*opacity: var\(--lantern-shadow-notes-opacity\);/);
    expect(css).not.toMatch(/\.d\.given/);
  });

  it("Reduce Motion: все переходы света умножены на --mo (мгновенно при «Уменьшении движения»)", () => {
    const transitions = css.match(/transition:[^;]+;/g) ?? [];
    expect(transitions.length).toBeGreaterThan(0);
    for (const t of transitions) expect(t).toContain("* var(--mo)");
    expect(css).not.toMatch(/prefers-reduced-motion/);
  });
});
