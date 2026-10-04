// PD-102 / PD-155: иконки P4 «Девять клеток» (до этого D5 «Унос») — все ссылки на иконки существуют, PNG имеют заявленные размеры и непрозрачны,
// знак maskable-иконки целиком внутри круга 80 %, иконки попадают в precache service worker.
// Источник правды по ссылкам — pwa.config.ts (манифест, includeAssets) и index.html.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_VERSION, includeAssets, manifestIcons } from "../pwa.config.ts";
import { decodePng } from "./png-decode.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const png = (publicPath) => decodePng(readFileSync(join(PUBLIC, publicPath.replace(/^\//, "").replace(/\?.*$/, ""))));

/** Пиксель «знака» (клетка), а не плашки: плашка — графит (max-канал <= 0x6E), клетка — бумага #E3E3E4 (>= 0xE3). */
const isMark = (r, g, b) => Math.max(r, g, b) > 0x80;

describe("манифест: иконки", () => {
  it("каждая иконка манифеста существует, это PNG, размеры совпадают с заявленными", () => {
    expect(manifestIcons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifestIcons) {
      const path = icon.src.replace(/\?.*$/, "");
      expect(existsSync(join(PUBLIC, path)), icon.src).toBe(true);
      const { width, height } = png(path);
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
      expect(icon.type).toBe("image/png");
    }
  });

  it("есть 192, 512 и maskable 512; у всех одна версия кэша", () => {
    const sizes = manifestIcons.filter((i) => i.purpose === undefined).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifestIcons.filter((i) => i.purpose === "maskable").map((i) => i.sizes)).toEqual(["512x512"]);
    for (const icon of manifestIcons) expect(icon.src).toMatch(new RegExp(`\\?v=${ICON_VERSION}$`));
  });

  it("includeAssets существуют и содержат favicon, apple-touch-icon", () => {
    for (const a of includeAssets) expect(existsSync(join(PUBLIC, a)), a).toBe(true);
    expect(includeAssets).toEqual(
      expect.arrayContaining(["icons/icon.svg", "icons/favicon-16.png", "icons/favicon-32.png", "icons/apple-touch-icon-180.png"]),
    );
  });
});

describe("index.html: ссылки на иконки", () => {
  const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon)"([^>]*)>/g)].map((m) => ({
    rel: m[1],
    href: /href="([^"]+)"/.exec(m[2])[1],
    sizes: /sizes="([^"]+)"/.exec(m[2])?.[1],
    type: /type="([^"]+)"/.exec(m[2])?.[1],
  }));

  it("ICON_VERSION сменён на p4 (iOS и CDN держат иконки по URL — старая D5 иначе осталась бы в кэше)", () => {
    expect(ICON_VERSION).toBe("p4");
  });

  it("favicon PNG 16 и 32, favicon SVG и apple-touch-icon 180 — все файлы на месте, версия кэша = ICON_VERSION", () => {
    expect(links.map((l) => l.rel)).toEqual(["icon", "icon", "icon", "apple-touch-icon"]);
    for (const l of links) {
      expect(l.href.startsWith("/icons/"), l.href).toBe(true);
      expect(l.href.endsWith(`?v=${ICON_VERSION}`), l.href).toBe(true);
      expect(existsSync(join(PUBLIC, l.href.replace(/\?.*$/, ""))), l.href).toBe(true);
    }
  });

  it("порядок: PNG-favicon 16 и 32, затем SVG (браузер с поддержкой SVG берёт его), размеры PNG совпадают", () => {
    expect(links[0].type).toBe("image/png");
    expect(links[1].type).toBe("image/png");
    expect(links[2].type).toBe("image/svg+xml");
    for (const l of [links[0], links[1]]) {
      const fav = png(l.href);
      expect(`${fav.width}x${fav.height}`).toBe(l.sizes);
    }
    expect([links[0].sizes, links[1].sizes]).toEqual(["16x16", "32x32"]);
    const touch = png(links[3].href);
    expect([touch.width, touch.height]).toEqual([180, 180]);
  });

  it("theme-color и startup-images не тронуты логотипом (графит не протекает в интерфейс)", () => {
    expect(html).toContain('media="(prefers-color-scheme: light)" content="#F2F2F7"');
    expect(html).toContain('media="(prefers-color-scheme: dark)" content="#000000"');
  });
});

describe("PNG иконок", () => {
  it("непрозрачны (иконка веб-клипа не может иметь альфу), кроме favicon-32 — у него прозрачные поля", () => {
    for (const name of ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon-180.png"]) {
      const { channels, data } = png(name);
      if (channels === 4) for (let i = 3; i < data.length; i += 4) expect(data[i], name).toBe(255);
    }
    for (const name of ["icons/favicon-16.png", "icons/favicon-32.png"]) {
      const fav = png(name);
      expect(fav.channels, name).toBe(4);
      expect(fav.data[3], name).toBe(0); // угол (0,0) — вне знака
    }
  });

  it("плашка — графит: левый верхний угол светлее правого нижнего, оба тёмные", () => {
    const { width, data, channels } = png("icons/icon-512.png");
    const px = (x, y) => [...data.subarray((y * width + x) * channels, (y * width + x) * channels + 3)];
    const tl = px(2, 2);
    const br = px(width - 3, width - 3);
    expect(Math.max(...tl)).toBeLessThanOrEqual(0x6e);
    expect(Math.max(...br)).toBeLessThanOrEqual(0x30);
    expect(tl[0]).toBeGreaterThan(br[0]);
  });
});

/** Цвет и альфа пикселя (x, y) как [r, g, b, a]. */
function px(name, x, y) {
  const { width, channels, data } = png(name);
  const o = (y * width + x) * channels;
  return [data[o], data[o + 1], data[o + 2], channels === 4 ? data[o + 3] : 255];
}
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

describe("P4 «Девять клеток»: девять клеток на плашке, контрформа — клетка (PD-155)", () => {
  // Центры клеток на канве 1024: столбцы 272/439/606 + 73, строки 189/356/523/690 + 73; пусты (439,356) и (439,690), (606,690).
  const colsC = [345, 512, 679];
  const rowsC = [262, 429, 596, 763];
  const EXPECT = ["XXX", "X.X", "XXX", "X.."];

  for (const [name, size] of [["icons/icon-512.png", 512], ["icons/icon-192.png", 192], ["icons/apple-touch-icon-180.png", 180]]) {
    it(`${name}: ровно девять светлых клеток по раскладке 3+2+3+1, остальные ячейки решётки — плашка`, () => {
      const k = size / 1024;
      let lit = 0;
      EXPECT.forEach((row, r) => {
        [...row].forEach((ch, c) => {
          const [R, G, B] = px(name, Math.round(colsC[c] * k), Math.round(rowsC[r] * k));
          const isLit = Math.max(R, G, B) > 0x80;
          expect(isLit, `${name} клетка r${r} c${c}`).toBe(ch === "X");
          if (isLit) {
            lit++;
            // цвет клетки — бумага #E3E3E4 (плоская заливка, без градиента прозрачности и чернил)
            expect([R, G, B], `${name} r${r} c${c}`).toEqual([0xe3, 0xe3, 0xe4]);
          }
        });
      });
      expect(lit).toBe(9);
    });

    it(`${name}: контраст контрформа (плашка) / клетка не ниже 10:1 (расчётный 10.5:1 — не понижать)`, () => {
      const k = size / 1024;
      const counter = px(name, Math.round(512 * k), Math.round(429 * k));
      const cell = px(name, Math.round(345 * k), Math.round(262 * k));
      expect(contrast(counter, cell)).toBeGreaterThan(10);
    });
  }

  it("favicon: клеточный 32 и сплошной 16 — один цвет #5F6DF2, ни одного сглаженного пикселя (альфа только 0/255)", () => {
    for (const name of ["icons/favicon-16.png", "icons/favicon-32.png"]) {
      const { data, channels } = png(name);
      let opaque = 0;
      for (let i = 0; i < data.length; i += channels) {
        const a = data[i + 3];
        expect([0, 255], `${name} альфа ${a}`).toContain(a);
        if (a === 255) {
          opaque++;
          expect([data[i], data[i + 1], data[i + 2]], name).toEqual([0x5f, 0x6d, 0xf2]);
        }
      }
      expect(opaque, name).toBeGreaterThan(0);
    }
  });

  it("favicon-32: девять клеток 6×6 с зазором 2 (клетки 3×3 сетки 16 при масштабе 2); favicon-16: сплошная «P» с контрформой 5×3", () => {
    const f32 = (x, y) => px("icons/favicon-32.png", x, y)[3] === 255;
    const f16 = (x, y) => px("icons/favicon-16.png", x, y)[3] === 255;
    const EXP32 = EXPECT;
    EXP32.forEach((row, r) => {
      [...row].forEach((ch, c) => {
        const x0 = (3 + c * 4) * 2;
        const y0 = (1 + r * 4) * 2;
        for (const [dx, dy] of [[0, 0], [5, 0], [0, 5], [5, 5], [2, 3]]) expect(f32(x0 + dx, y0 + dy), `32 r${r} c${c}`).toBe(ch === "X");
        // зазор справа от клетки — прозрачный (даже у крайней клетки: правее тоже пусто)
        expect(f32(x0 + 6, y0 + 2), `32 зазор r${r} c${c}`).toBe(false);
      });
    });
    // сплошная 16: стойка x 3..5, y 1..14; перекладина y 1..3, x 3..13; стенка x 11..13, y 1..9; донце y 7..9; контрформа x 6..10, y 4..6
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const stem = x >= 3 && x <= 5 && y >= 1 && y <= 14;
        const top = y >= 1 && y <= 3 && x >= 3 && x <= 13;
        const wall = x >= 11 && x <= 13 && y >= 1 && y <= 9;
        const bottom = y >= 7 && y <= 9 && x >= 3 && x <= 13;
        expect(f16(x, y), `16 (${x},${y})`).toBe(stem || top || wall || bottom);
      }
    for (let y = 4; y <= 6; y++) for (let x = 6; x <= 10; x++) expect(f16(x, y), `16 контрформа (${x},${y})`).toBe(false);
  });
});

/** Максимальный радиус знака от центра, в долях канвы. */
function markRadiusShare(name) {
  const { width, height, channels, data } = png(name);
  let max = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      if (!isMark(data[o], data[o + 1], data[o + 2])) continue;
      count++;
      // самый дальний угол пикселя, не центр: считаем по внешнему краю
      const dx = Math.abs(x + 0.5 - width / 2) + 0.5;
      const dy = Math.abs(y + 0.5 - height / 2) + 0.5;
      max = Math.max(max, Math.hypot(dx, dy) / width);
    }
  }
  return { share: max, count };
}

describe("maskable: знак внутри круга 80 % (радиус 0.4 от стороны)", () => {
  for (const name of ["icons/icon-512.png", "icons/icon-192.png"]) {
    it(`${name}: ни один пиксель знака не выходит за круг; запас не меньше 1 %`, () => {
      const { share, count } = markRadiusShare(name);
      expect(count).toBeGreaterThan(500); // знак вообще есть
      // P4: дальняя точка — дуга верхней правой клетки, 390.5 из 1024 = 0.381 (запас 19.1); круг maskable — 409.6 = 0.400.
      expect(share).toBeLessThan(0.4);
      expect(share).toBeGreaterThan(0.36); // знак не съёжен: габарит 47 % × 63 % канвы
    });
  }

  it("maskable-запись манифеста указывает на icon-512 (тот же PNG, что проверен)", () => {
    const m = manifestIcons.find((i) => i.purpose === "maskable");
    expect(m.src.replace(/\?.*$/, "")).toBe("icons/icon-512.png");
  });
});

describe("service worker: precache содержит иконки (нужна сборка: pnpm build)", () => {
  const sw = join(ROOT, "dist", "sw.js");
  it.skipIf(!existsSync(sw))("sw.js precache: все иконки манифеста, favicon 16/32, apple-touch-icon", () => {
    const text = readFileSync(sw, "utf8");
    for (const url of ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon-180.png", "icons/favicon-16.png", "icons/favicon-32.png", "icons/icon.svg"]) {
      expect(text, url).toMatch(new RegExp(`url:"${url.replace(".", "\\.")}",revision:"[0-9a-f]{32}"`));
    }
    // параметр ?v= срезается при сопоставлении (иначе <link ...?v=p4> офлайн мимо precache)
    expect(text).toMatch(/ignoreURLParametersMatching:\[[^\]]*\/\^v\$\//);
  });
});
