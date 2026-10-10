import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";

type Tree = { [k: string]: string | Tree };

/** Плоские ключи блока `year.*` → значения. */
function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, "");
const year = (l: { year: Tree }) => flatten(l.year);
const bases = (l: { year: Tree }) => [...new Set(Object.keys(year(l)).map(base))].sort();
const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");

describe("i18n: блок year.* (PD-25)", () => {
  it("ключи en, uk и ru совпадают (без пропусков и лишних)", () => {
    expect(bases(uk as { year: Tree })).toEqual(bases(en as { year: Tree }));
    expect(bases(ru as { year: Tree })).toEqual(bases(en as { year: Tree }));
  });

  it("плюральные формы: en one/other, uk и ru one/few/many/other", () => {
    const forms = (l: { year: Tree }, key: string) =>
      Object.keys(year(l))
        .filter((k) => base(k) === key && PLURAL.test(k))
        .map((k) => k.match(PLURAL)![1])
        .sort();
    for (const key of ["totalsDays", "monthSummary"]) {
      expect(forms(en as { year: Tree }, key)).toEqual(["one", "other"]);
      expect(forms(uk as { year: Tree }, key)).toEqual(["few", "many", "one", "other"]);
      expect(forms(ru as { year: Tree }, key)).toEqual(["few", "many", "one", "other"]);
    }
  });

  it("блок archive.* (PD-33): те же ключи и плейсхолдеры во всех локалях, без пустых строк", () => {
    const a = (l: object) => flatten((l as { archive: Tree }).archive);
    const e = a(en);
    expect(Object.keys(e).sort()).toEqual(["backLabel", "backLabelPlay", "failed", "loading", "title", "unavailable"]); // backLabelPlay — PD-282
    for (const l of [uk, ru]) {
      expect(Object.keys(a(l)).sort()).toEqual(Object.keys(e).sort());
      for (const [k, v] of Object.entries(a(l))) {
        expect(v, k).not.toBe("");
        expect(placeholders(v), k).toBe(placeholders(e[k]!));
      }
    }
  });

  it("PD-51: «до начала» в Year — про первую запись, а не про начало пользования (en/uk/ru)", () => {
    const y = (l: object) => (l as { year: { state: { before: string }; card: { before: string } } }).year;
    expect(y(en).state.before).toBe("before your first entry");
    expect(y(en).card.before).toBe("Before your first entry.");
    expect(y(uk).state.before).toBe("до першого запису");
    expect(y(uk).card.before).toBe("До першого запису.");
    expect(y(ru).state.before).toBe("до первой записи");
    expect(y(ru).card.before).toBe("До первой записи.");
  });

  it("PD-125: «решено позже» и предупреждение до старта — во всех локалях, согласованным словом (en/uk/ru)", () => {
    type L = { year: { legend: { late: string }; state: Record<string, string>; card: { lateNote: string; lateWarning: string }; totalsLate: string; monthLate: string } };
    const cases: [object, string, string][] = [
      [en, "solved late", "“solved late”"],
      [uk, "розв’язано пізніше", "«розв’язано пізніше»"],
      [ru, "решено позже", "«решено позже»"],
    ];
    for (const [l, word, quoted] of cases) {
      const y = (l as L).year;
      expect(y.legend.late.toLowerCase()).toBe(word);
      expect(y.state["late"]).toBe(word);
      for (const k of ["lateCorrections", "lateHelp", "lateHelpCorrections"]) expect(y.state[k]!.startsWith(`${word}, `), k).toBe(true);
      // и предупреждение до старта, и пометка после решения называют состояние одним и тем же словом
      expect(y.card.lateWarning).toContain(quoted);
      expect(y.card.lateNote).toContain(quoted);
      expect(y.totalsLate).toContain(word);
      expect(y.monthLate).toContain(word);
      // ни одна строка про «решено позже» не называет день пропуском (прежний текст «считается пропуском» убран)
      for (const v of [y.card.lateNote, y.card.lateWarning, ...Object.values(y.state).filter((v) => v.startsWith(word))]) expect(v).not.toMatch(/missed|пропуск|пропущ/i);
    }
  });

  it("нет пустых строк; плейсхолдеры одинаковы во всех локалях", () => {
    const e = year(en as { year: Tree });
    for (const l of [uk, ru] as { year: Tree }[]) {
      for (const [k, v] of Object.entries(year(l))) {
        expect(v, k).not.toBe("");
        const ref = e[k] ?? e[`${base(k)}_other`] ?? e[base(k)];
        expect(ref, `нет образца в en для ${k}`).toBeDefined();
        expect(placeholders(v), k).toBe(placeholders(ref as string));
      }
    }
  });
});
