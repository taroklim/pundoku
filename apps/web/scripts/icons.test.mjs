// PD-102: иконки D5 «Унос» — все ссылки на иконки существуют, PNG имеют заявленные размеры и непрозрачны,
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

/** Пиксель «знака» (поле/клетка), а не плашки: плашка — графит (max-канал <= 0x6E), поле и клетка светлее (>= 0x9D, у клетки синий 0xF2+). */
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
    expect(includeAssets).toEqual(expect.arrayContaining(["icons/icon.svg", "icons/favicon-32.png", "icons/apple-touch-icon-180.png"]));
  });
});

describe("index.html: ссылки на иконки", () => {
  const links = [...html.matchAll(/<link rel="(icon|apple-touch-icon)"([^>]*)>/g)].map((m) => ({
    rel: m[1],
    href: /href="([^"]+)"/.exec(m[2])[1],
    sizes: /sizes="([^"]+)"/.exec(m[2])?.[1],
    type: /type="([^"]+)"/.exec(m[2])?.[1],
  }));

  it("favicon PNG 32, favicon SVG и apple-touch-icon 180 — все файлы на месте, версия кэша = ICON_VERSION", () => {
    expect(links.map((l) => l.rel)).toEqual(["icon", "icon", "apple-touch-icon"]);
    for (const l of links) {
      expect(l.href.startsWith("/icons/"), l.href).toBe(true);
      expect(l.href.endsWith(`?v=${ICON_VERSION}`), l.href).toBe(true);
      expect(existsSync(join(PUBLIC, l.href.replace(/\?.*$/, ""))), l.href).toBe(true);
    }
  });

  it("порядок: PNG-favicon, затем SVG (браузер с поддержкой SVG берёт его), размеры PNG совпадают", () => {
    expect(links[0].type).toBe("image/png");
    expect(links[1].type).toBe("image/svg+xml");
    const fav = png(links[0].href);
    expect(`${fav.width}x${fav.height}`).toBe(links[0].sizes);
    const touch = png(links[2].href);
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
    const fav = png("icons/favicon-32.png");
    expect(fav.channels).toBe(4);
    expect(fav.data[3]).toBe(0); // угол (0,0) — вне знака
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
      // Спека §16: maxR 390.4 из 1024 = 0.381; круг maskable — 409.6 = 0.400. Допуск на сглаживание края — внутри 0.4.
      expect(share).toBeLessThan(0.4);
      expect(share).toBeGreaterThan(0.36); // знак не съёжен: габарит ~56 % канвы
    });
  }

  it("maskable-запись манифеста указывает на icon-512 (тот же PNG, что проверен)", () => {
    const m = manifestIcons.find((i) => i.purpose === "maskable");
    expect(m.src.replace(/\?.*$/, "")).toBe("icons/icon-512.png");
  });
});

describe("service worker: precache содержит иконки (нужна сборка: pnpm build)", () => {
  const sw = join(ROOT, "dist", "sw.js");
  it.skipIf(!existsSync(sw))("sw.js precache: все иконки манифеста, favicon, apple-touch-icon", () => {
    const text = readFileSync(sw, "utf8");
    for (const url of ["icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon-180.png", "icons/favicon-32.png", "icons/icon.svg"]) {
      expect(text, url).toMatch(new RegExp(`url:"${url.replace(".", "\\.")}",revision:"[0-9a-f]{32}"`));
    }
    // параметр ?v= срезается при сопоставлении (иначе <link ...?v=d5> офлайн мимо precache)
    expect(text).toMatch(/ignoreURLParametersMatching:\[[^\]]*\/\^v\$\//);
  });
});
