/**
 * PD-254: отклик нажатия вкладки таб-бара — иконка+подпись приглушаются на время касания (`.tab:active`), без масштаба и
 * без transform; затемнение мгновенное, обратный фейд — длительность * --mo (при «Уменьшении движения» 0 s). В покое вид
 * прежний. Переключение вкладки по-прежнему по click (проверяет App.tabbar.test / TabBar), здесь — только CSS и условие
 * срабатывания :active на iOS — в tabPress.touch.test.tsx.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/shell.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Тела всех правил верхнего уровня, в списке селекторов которых есть ровно `sel` (как в tabHitArea.css.test). */
function rule(sel: string): string {
  const bodies: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(sel)) bodies.push(m[2]!);
  }
  return bodies.join("\n");
}
/** Все правила (селектор + тело), где селектор касается вкладки / пилюли. */
const tabRules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => /\.tab(?![a-z-])|\.tab-pill/.test(m[1]!));

describe("PD-254: отклик нажатия вкладки (shell.css)", () => {
  it(".tab:active приглушает вкладку прозрачностью (лёгко, но заметно)", () => {
    const a = rule(".tab:active");
    const m = a.match(/opacity: ([\d.]+);/);
    expect(m).not.toBeNull();
    const o = Number(m![1]);
    expect(o).toBeGreaterThanOrEqual(0.4);
    expect(o).toBeLessThan(1);
  });

  it("ни одно правило вкладки/пилюли не масштабирует нажатие: нет scale/zoom, :active без transform", () => {
    expect(rule(".tab:active")).not.toMatch(/transform|scale|zoom|translate/);
    for (const m of tabRules) {
      expect(m[2]).not.toMatch(/scale\(|zoom|(^|[^-])scale:/);
      if (m[1]!.includes(":active")) expect(m[2]).not.toMatch(/transform|translate/);
    }
  });

  it("в покое вид прежний: у .tab нет собственной opacity/filter, пилюля в :active не участвует", () => {
    expect(rule(".tab")).not.toMatch(/(^|[\s;])opacity:|filter:/);
    for (const m of tabRules) {
      if (m[1]!.includes(":active")) expect(m[1]).not.toMatch(/tab-pill/);
    }
  });

  it("затемнение мгновенное, обратный фейд — длительность * --mo (Reduce Motion: --mo = 0 → без перехода)", () => {
    expect(rule(".tab")).toMatch(/opacity calc\(0\.2s \* var\(--mo\)\) linear/);
    expect(rule(".tab:active")).toMatch(/opacity 0s/);
    // Цвет выбранной вкладки по-прежнему меняется своим переходом (макет PD-158 §1) — :active его не сбрасывает.
    expect(rule(".tab")).toMatch(/color 0\.12s linear/);
    expect(rule(".tab:active")).toMatch(/color 0\.12s linear/);
    // Reduce Motion читается только в tokens.css (PD-89) — отдельного @media здесь нет.
    expect(css).not.toMatch(/prefers-reduced-motion/);
  });

  it("при Reduce Motion длительность фейда считается в 0 s", () => {
    const tokens = fs.readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{\s*--mo: 0;/);
  });
});
