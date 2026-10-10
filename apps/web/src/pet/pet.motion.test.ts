/**
 * PD-260: движение Питомца = макет PD-223, вариант B «Капля» (`design/pd223-pet-motion.html`). Читаем CSS и сам макет и сверяем:
 * keyframes и тайминги дословно, только transform/opacity, амплитуды × --mo (Reduce Motion → тождественный transform в каждом
 * ключевом кадре), покой — постоянное дыхание (PD-297; было «3 вдоха»), пауза вне экрана, раскладка листа дня Year на AX3 (зазор до кляксы, перенос длинного слова).
 * Живая проверка тех же правил в chromium/webkit — `design/pd260-check.mjs`.
 */
import { describe, expect, it } from "vitest";
import { actDuration } from "./petMotion";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const css = strip(fs.readFileSync(new URL("../styles/pet.css", import.meta.url), "utf8"));
const html = fs.readFileSync(new URL("../../../../design/pd223-pet-motion.html", import.meta.url), "utf8");
const mockCss = strip(html.slice(html.indexOf("<style>"), html.indexOf("</style>")));

/** Все @keyframes файла: имя → тело. */
function keyframes(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < src.length && depth > 0; i++) depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0;
    out.set(m[1]!, src.slice(re.lastIndex, i - 1));
  }
  return out;
}
/** Канон для сравнения: без пробелов, `0.5` = `.5`. */
const norm = (s: string) => s.replace(/\s+/g, "").replace(/(^|[^\d])0\./g, "$1.").replace(/;}/g, "}");

const ours = keyframes(css);
const mock = keyframes(mockCss);
// Наше имя → имя в макете (вариант B; у нас префикс pet, чтобы не пересечься с другими экранами).
const MAP: Record<string, string> = {
  petBreathB: "breathB",
  petBreathS: "breathS",
  petArriveB: "arriveB",
  petArriveBTired: "arriveBTired",
  petArriveBSurp: "arriveBSurp",
  petSplashIn: "splashIn",
  petGatherOut: "gatherOut",
  petGatherIn: "gatherIn",
  petAbsorbOut: "absorbOut",
  petSplashLate: "splashLate",
};

describe("keyframes = макет PD-223 B", () => {
  it("набор: только вариант B (без A/C и без «уснуть» — в приложении не бывает), старого дыхания petBreathe нет", () => {
    expect([...ours.keys()].sort()).toEqual(Object.keys(MAP).sort());
    expect(css).not.toMatch(/petBreathe/);
    // PD-297: бесконечен только покой (.breath), действия — один раз.
    expect(css.match(/infinite/g)).toHaveLength(1);
  });
  it.each(Object.entries(MAP))("%s дословно = %s макета", (name, theirs) => {
    expect(mock.has(theirs)).toBe(true);
    expect(norm(ours.get(name)!)).toBe(norm(mock.get(theirs)!));
  });
  it("тайминги = таблица DUR.B макета", () => {
    const dur = new Function(`${html.slice(html.indexOf("const DUR = {"), html.indexOf("function durOf"))}; return DUR;`)() as {
      B: Record<string, [number, number]>;
    };
    expect(actDuration("arrive", "happy")).toEqual(dur.B.arrive);
    expect(actDuration("arrive", "tired")).toEqual(dur.B.arrive_tired);
    expect(actDuration("arrive", "surprised")).toEqual(dur.B.arrive_surprised);
    expect(actDuration("wake", "happy")).toEqual(dur.B.wake);
  });
});

describe("лёгкость для WebKit и Reduce Motion", () => {
  it("в keyframes только transform / opacity (и кривая ключевого кадра); нет filter, clip-path, layout", () => {
    for (const [name, body] of ours) {
      const props = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
      for (const p of props) expect(["transform", "opacity", "animation-timing-function"], `${name}: ${p}`).toContain(p);
    }
    expect(css).not.toMatch(/filter|blur|clip-path|will-change/);
  });

  /** Значение трансформа при --mo = 0: подставляем переменные, считаем calc. */
  const evalArg = (a: string): number => {
    const js = a
      .replace(/var\(--mo\)/g, "0")
      .replace(/var\(--u\)/g, "1")
      .replace(/var\(--(dx|dy)\)/g, "7")
      .replace(/var\(--(sx|sy|isx|isy)\)/g, "1.37")
      .replace(/calc/g, "")
      .replace(/(\d)(px|deg)/g, "$1");
    return new Function(`return (${js});`)() as number;
  };
  it("при --mo = 0 каждый ключевой кадр — тождественный transform (клякса стоит; остаётся только прозрачность)", () => {
    let checked = 0;
    for (const [name, body] of ours) {
      for (const t of body.matchAll(/transform:\s*([^;]+);/g)) {
        for (const fn of t[1]!.matchAll(/(translate[XY]?|scale|skewX)\(((?:[^()]|\([^()]*(?:\([^()]*\))*[^()]*\))*)\)/g)) {
          const args = fn[2]!.split(/,(?![^()]*\))/).map(evalArg);
          const identity = fn[1]!.startsWith("scale") ? 1 : 0;
          for (const v of args) expect(v, `${name}: ${fn[0]}`).toBeCloseTo(identity, 9);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it("длительность действия при RM — короткое значение макета (--d-rm), полная — × --mo", () => {
    expect(css).toMatch(/\.pet\[data-act\]\s*\{\s*--D: calc\(var\(--d-rm\) \+ var\(--mo\) \* \(var\(--d-full\) - var\(--d-rm\)\)\);/);
  });

  it("покой (PD-297): дыхание бесконечно (4,2 с; «спит» — 6,5 с) после действия; только при data-idle; скрытая — без анимаций, вне экрана — пауза", () => {
    const idle = /\.pet\[data-idle\] \.breath\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(idle).toMatch(/animation-name: petBreathB;/);
    expect(idle).toMatch(/animation-duration: 4\.2s;/);
    expect(idle).toMatch(/animation-iteration-count: infinite;/);
    expect(idle).toMatch(/animation-delay: calc\(var\(--act-delay, 0ms\) \+ var\(--D, 0ms\)\);/);
    expect(css).toMatch(/\.pet\[data-idle\]\[data-mood="asleep"\] \.breath\s*\{\s*animation-name: petBreathS;\s*animation-duration: 6\.5s;/);
    expect(css).toMatch(/\.pet\[data-still\] \*\s*\{\s*animation: none !important;/);
    expect(css).toMatch(/\.pet\[data-paused\] \*\s*\{\s*animation-play-state: paused !important;/);
    // Без data-idle у .breath нет анимации (RM, скрытая вкладка).
    expect(css).not.toMatch(/(^|\})\s*\.pet \.breath\s*\{[^}]*animation/);
  });

  it("новых цветов нет: только токены и системные цвета forced-colors; питомец не ловит касания", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    expect(/\.pet\s*\{([^}]*)\}/.exec(css)![1]).toMatch(/pointer-events: none;/);
    const vars = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    const allowed = ["--ink", "--label", "--label-2", "--mo", "--e-io", "--e-out", "--u", "--D", "--d-rm", "--d-full", "--act-delay", "--dx", "--dy", "--sx", "--sy", "--isx", "--isy"];
    for (const v of vars) expect(allowed).toContain(v);
  });
});

describe("лист дня Year: 320 pt + AX3 — дата не наезжает на кляксу (кадры PD-223)", () => {
  it("на AX3 зазор до кляксы 8 pt (самое длинное слово даты помещается), длинное слово переносится, а не уезжает под кляксу", () => {
    expect(css).toMatch(/:root\[data-type="ax3"\] \.daycard \.dc-head\s*\{\s*gap: 8px;/);
    expect(/\.daycard \.dc-head h3\s*\{([^}]*)\}/.exec(css)![1]).toMatch(/min-width: 0;\s*overflow-wrap: anywhere;/);
    // Центр по строке даты (PD-184, решение владельца 2B) не тронут.
    expect(/\.daycard \.dc-head\s*\{([^}]*)\}/.exec(css)![1]).toMatch(/align-items: center;/);
  });
});
