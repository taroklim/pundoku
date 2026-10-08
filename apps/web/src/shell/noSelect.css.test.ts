/**
 * PD-210 (решение владельца): удержание клетки/кнопки нигде в приложении не выделяет текст и не вызывает лупу/выноску iOS —
 * правило в shell.css на управляющих элементах, поле, пад, таб-бар и шапку; поля ввода (e-mail/пароль/код в Настройках)
 * выделение сохраняют. Живая проверка computed style — design/pd210-check.mjs.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/shell.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Тело правила, селектор-список которого содержит все `sels`. */
function ruleWith(...sels: string[]): string {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const list = m[1]!.split(",").map((s) => s.trim());
    if (sels.every((s) => list.includes(s))) return m[2]!;
  }
  return "";
}

describe("нет выделения текста при удержании (shell.css)", () => {
  it("кнопки, ссылки, роли меню/вкладок, поле, пад, действия, таб-бар, шапка — user-select: none + touch-callout: none", () => {
    const body = ruleWith("button", "a[href]", "label", '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]', ".board", ".pad-wrap", ".actions", ".tabbar", ".toolbar");
    expect(body).toMatch(/-webkit-user-select: none;/);
    expect(body).toMatch(/(^|[^-])user-select: none;/);
    expect(body).toMatch(/-webkit-touch-callout: none;/);
    expect(body).toMatch(/-webkit-tap-highlight-color: transparent;/);
  });

  it("поля ввода выделение сохраняют (идут после общего правила)", () => {
    const body = ruleWith("input", "textarea");
    expect(body).toMatch(/-webkit-user-select: text;/);
    expect(body).toMatch(/(^|[^-])user-select: text;/);
    expect(body).toMatch(/-webkit-touch-callout: default;/);
    expect(css.indexOf("\ninput,")).toBeGreaterThan(css.indexOf(".toolbar {"));
  });

  it("не на html/body/*: обычный текст по-прежнему выделяется", () => {
    for (const sel of ["html", "body", "*"]) expect(ruleWith(sel)).not.toMatch(/user-select: none/);
  });
});
