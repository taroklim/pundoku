// Согласованность экранов запуска iOS: таблица устройств ↔ <link> в index.html ↔ PNG в public/splash
// (размеры, цвет заливки = токены темы). Устаревший артефакт → тест красный, лечится `pnpm splash`.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  DEVICES,
  LAUNCH_COLORS,
  SCHEMES,
  linkTags,
  mediaQuery,
  pixelSize,
  publicPath,
} from "./startup-devices.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const tokens = readFileSync(join(ROOT, "src", "styles", "tokens.css"), "utf8");

/** Разбор PNG: размеры и цвет первого пикселя (индексный 1-bit либо RGB 8-bit). */
function readPng(path) {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colorType = buf[25];
  let plte = null;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    const type = buf.subarray(o + 4, o + 8).toString("ascii");
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "PLTE") plte = data;
    if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  let rgb;
  if (colorType === 3) {
    const shift = 8 - depth;
    const index = raw[1] >> shift;
    rgb = [...plte.subarray(index * 3, index * 3 + 3)];
  } else if (colorType === 2 && depth === 8) {
    rgb = [...raw.subarray(1, 4)];
  } else {
    throw new Error(`unsupported PNG ${depth}/${colorType}`);
  }
  return { width, height, rgb };
}

describe("apple-touch-startup-image", () => {
  it("блок <link> в index.html актуален (выдаётся генератором)", () => {
    const begin = html.indexOf(BLOCK_BEGIN);
    const end = html.indexOf(BLOCK_END);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    const block = html.slice(begin + BLOCK_BEGIN.length, end).trim();
    expect(block).toBe(linkTags().trim());
  });

  it("есть iPhone 16 (393×852 @3 → 1179×2556) в светлой и тёмной теме", () => {
    for (const scheme of SCHEMES) {
      const d = DEVICES.find((x) => x.width === 393 && x.height === 852 && x.ratio === 3);
      expect(d).toBeDefined();
      expect(html).toContain(
        `<link rel="apple-touch-startup-image" media="${mediaQuery(scheme, d)}" href="/splash/launch-${scheme}-1179x2556.png" />`,
      );
    }
  });

  it("есть iPhone Air (420×912 @3 → 1260×2736), Plus 8/7/6s и SE 1", () => {
    const want = [
      [420, 912, 3, "1260x2736"],
      [414, 736, 3, "1242x2208"],
      [320, 568, 2, "640x1136"],
    ];
    for (const [w, h, r, px] of want) {
      const d = DEVICES.find((x) => x.width === w && x.height === h && x.ratio === r);
      expect(d, `${w}×${h}@${r}`).toBeDefined();
      for (const scheme of SCHEMES) {
        expect(html).toContain(
          `<link rel="apple-touch-startup-image" media="${mediaQuery(scheme, d)}" href="/splash/launch-${scheme}-${px}.png" />`,
        );
      }
    }
  });

  it("имена файлов уникальны (одинаковый пиксельный размер при разном pt не затирает PNG)", () => {
    const all = DEVICES.flatMap((d) => SCHEMES.map((s) => publicPath(s, d)));
    expect(new Set(all).size).toBe(all.length);
  });

  it("media-запросы уникальны — ни одна пара не перекрывается", () => {
    const all = DEVICES.flatMap((d) => SCHEMES.map((s) => mediaQuery(s, d)));
    expect(new Set(all).size).toBe(all.length);
  });

  for (const d of DEVICES) {
    for (const scheme of SCHEMES) {
      const { w, h } = pixelSize(d);
      it(`${scheme} ${w}×${h}: PNG существует, размер и цвет = токен темы`, () => {
        const file = join(ROOT, "public", publicPath(scheme, d));
        expect(existsSync(file)).toBe(true);
        const png = readPng(file);
        expect(png.width).toBe(w);
        expect(png.height).toBe(h);
        expect(png.rgb).toEqual(LAUNCH_COLORS[scheme].rgb);
      });
    }
  }

  it("цвета заливки совпадают с --bg-grouped в tokens.css", () => {
    const light = /--bg-grouped:\s*(#[0-9a-f]{6})/i.exec(tokens);
    expect(light?.[1].toLowerCase()).toBe(LAUNCH_COLORS.light.hex.toLowerCase());
    const dark = /prefers-color-scheme:\s*dark\)\s*\{[^}]*?--bg-grouped:\s*(#[0-9a-f]{6})/is.exec(tokens);
    expect(dark?.[1].toLowerCase()).toBe(LAUNCH_COLORS.dark.hex.toLowerCase());
  });

  it("inline-фон html и мета theme-color совпадают с токенами", () => {
    expect(html).toMatch(/html\s*\{\s*background:\s*#f2f2f7;/i);
    expect(html).toMatch(/prefers-color-scheme: dark\)\s*\{\s*html\s*\{\s*background:\s*#000000;/i);
    expect(html).toContain('media="(prefers-color-scheme: light)" content="#F2F2F7"');
    expect(html).toContain('media="(prefers-color-scheme: dark)" content="#000000"');
  });
});
