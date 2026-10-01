// Минимальный декодер PNG для тестов иконок (8 бит, RGB или RGBA, без интерлейса, все пять фильтров).
// Нужен, чтобы проверять иконки по пикселям без новых зависимостей (pngjs в apps/web не ставится).
import { inflateSync } from "node:zlib";

/** @returns {{ width: number, height: number, channels: 3 | 4, data: Uint8Array }} data — построчно, без фильтр-байтов */
export function decodePng(buf) {
  if (buf.subarray(1, 4).toString("ascii") !== "PNG") throw new Error("not a PNG");
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colorType = buf[25];
  if (depth !== 8 || (colorType !== 2 && colorType !== 6) || buf[28] !== 0) {
    throw new Error(`unsupported PNG: depth ${depth}, colorType ${colorType}, interlace ${buf[28]}`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const idat = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    if (buf.subarray(o + 4, o + 8).toString("ascii") === "IDAT") idat.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[y * stride + x - channels] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? data[(y - 1) * stride + x - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      data[y * stride + x] = (line[x] + add) & 0xff;
    }
  }
  return { width, height, channels, data };
}
