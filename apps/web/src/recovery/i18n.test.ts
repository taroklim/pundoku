import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";

type Tree = { [k: string]: string | Tree };

function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const settings = (l: object) => flatten((l as { settings: Tree }).settings);
const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");

describe("i18n: блок settings.* (PD-49)", () => {
  const e = settings(en);

  it("в en есть все ключи, которые использует экран", () => {
    for (const k of [
      "title", "language", "open", "backLabel", "key.head", "key.create", "key.haveKey", "key.yourKey", "key.keyLabel", "key.keyGroup",
      "key.shownOnce", "key.copy", "key.copied", "key.warn", "key.saved", "key.rowCreated", "key.rowDevices", "key.reissue", "key.unlink",
      "key.deleteKey", "key.footNone", "key.footCreated", "key.footDanger", "key.footEnter", "key.enterLabel", "key.enterPlaceholder",
      "key.enterHint", "key.restore", "key.checking", "key.cancel", "key.restored", "key.errKey", "key.errLimit", "key.errOffline",
      "key.errGeneric", "key.retry", "key.statusFailed", "key.sheetReTitle", "key.sheetReMsg", "key.sheetReGo", "key.sheetUnTitle",
      "key.sheetUnMsg", "key.sheetUnGo", "key.sheetDelTitle", "key.sheetDelMsg", "key.sheetDelGo", "key.sheetLeaveTitle",
      "key.sheetLeaveMsg", "key.sheetLeaveGo", "key.sheetLeaveStay",
    ]) {
      expect(e[k], k).toBeTruthy();
    }
  });

  it("ключи en, uk и ru совпадают (без пропусков и лишних)", () => {
    expect(Object.keys(settings(uk)).sort()).toEqual(Object.keys(e).sort());
    expect(Object.keys(settings(ru)).sort()).toEqual(Object.keys(e).sort());
  });

  it("нет пустых строк; плейсхолдеры ({{minutes}}, {{n}}…) одинаковы во всех локалях", () => {
    for (const l of [uk, ru]) {
      for (const [k, v] of Object.entries(settings(l))) {
        expect(v, k).not.toBe("");
        expect(placeholders(v), k).toBe(placeholders(e[k]!));
      }
    }
    expect(placeholders(e["key.errLimit"]!)).toBe("minutes");
    expect(placeholders(e["key.keyGroup"]!)).toBe("chars,n,total");
  });

  it("uk и ru переведены, а не скопированы из en (кроме образца ключа)", () => {
    for (const l of [uk, ru]) {
      const t = settings(l);
      for (const k of Object.keys(e)) {
        if (k === "key.enterPlaceholder") continue;
        expect(t[k], k).not.toBe(e[k]);
      }
    }
  });
});
