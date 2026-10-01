// Самопроверка iPhone-чек-листа Pundoku: webkit-эмуляция iPhone 16. Запуск: node selfcheck.mjs [s1 s2 ...]
import { webkit, Results, ART } from "./lib.mjs";

const SECTIONS = { s1: "./s1-shell.mjs", s2: "./s2-play.mjs", s3: "./s3-year.mjs", s4: "./s4-settings.mjs", s5: "./s5-ink.mjs" };
const want = process.argv.slice(2);
const names = want.length ? want : Object.keys(SECTIONS);
const browser = await webkit.launch();
const R = new Results(`${ART}/results-${names.join("-")}.json`);
let failed = 0;
for (const n of names) {
  console.log(`== ${n} ==`);
  try {
    const mod = await import(SECTIONS[n]);
    await mod.run(R, browser);
  } catch (e) {
    failed++;
    console.log(`  SECTION ${n} CRASHED: ${e.stack ?? e}`);
    R.add(`crash-${n}`, false, String(e.message));
  }
  R.save();
}
await browser.close();
const fails = Object.entries(R.items).flatMap(([id, a]) => a.filter((x) => !x.ok).map((x) => `${id}: ${x.note}`));
console.log(`\nИтого проверок: ${Object.values(R.items).flat().length}, не прошло: ${fails.length}`);
fails.forEach((f) => console.log("  FAIL " + f));
process.exit(failed ? 1 : 0);
