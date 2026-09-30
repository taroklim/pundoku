/**
 * Отпечаток дня для PNG (PD-75, решение владельца: стиль «Rhythm»): тон квадрата — порядок заполнения, размер —
 * сколько думал. 1080×1350, целое масштабирование сетки 9×9, без цифр (ни игрока, ни решения); подсказки — пустые
 * контуры; клякса — сургуч со сколотым углом. Картинка ВСЕГДА светлая, независимо от темы приложения (её публикуют
 * на чужой фон), поэтому цвета здесь зашиты, а не берутся из CSS-токенов.
 *
 * `fingerprintLayout` — чистая функция (тестируется без canvas); `drawFingerprint` рисует макет; `renderFingerprintPng`
 * даёт Blob; `shareFingerprint` отдаёт файл системному листу (`navigator.share`), иначе скачивание.
 */
import type { TimelapseFingerprint } from "@pundoku/engine";
import { HEAT_MAX, HEAT_MIN } from "./heat";
import { dwellScales, rhythmScale } from "./timelapseModel";

export const FP_WIDTH = 1080;
export const FP_HEIGHT = 1350;
/** Сторона ячейки, зазор, шаг: 9·96 + 8·8 = 928 — целые пиксели при любом округлении. */
export const FP_CELL = 96;
export const FP_GAP = 8;
export const FP_PITCH = FP_CELL + FP_GAP;
export const FP_GRID = 9 * FP_CELL + 8 * FP_GAP;
export const FP_PAD = (FP_WIDTH - FP_GRID) / 2;
export const FP_GRID_TOP = 150;
export const FP_CAPTION_Y = FP_HEIGHT - FP_PAD;

/** Светлая палитра PNG (значения — из tokens.css, светлая тема). */
export const FP_COLORS = {
  paper: "#ffffff",
  ink: "#3b48b0",
  wax: "#b3261e",
  hairline: "rgba(60, 60, 67, 0.29)",
  label: "#1c1c1e",
  label2: "#6e6e73",
} as const;

export type FpKind = "given" | "ink" | "blot";

export interface FpSquare {
  readonly cell: number;
  readonly kind: FpKind;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  /** Тон по порядку заполнения (`HEAT_MIN..HEAT_MAX`); у подсказок 1. */
  readonly opacity: number;
}

export interface FpLayout {
  readonly width: number;
  readonly height: number;
  readonly squares: readonly FpSquare[];
}

/**
 * Макет сетки. `mission` — 81 символ (`0`/`.` пусто, иначе цифра — подсказка): подсказки рисуются пустым контуром,
 * остальное — по `fp.cells` (верно заполненные). Клетка без отпечатка и не подсказка (в решённом дне не бывает)
 * остаётся пустым контуром.
 */
export function fingerprintLayout(fp: TimelapseFingerprint, mission: string): FpLayout {
  const dwell = dwellScales(fp);
  const span = Math.max(1, fp.placed - 1);
  const squares: FpSquare[] = [];
  for (let cell = 0; cell < 81; cell++) {
    const r = Math.floor(cell / 9);
    const c = cell % 9;
    const sx = FP_PAD + c * FP_PITCH;
    const sy = FP_GRID_TOP + r * FP_PITCH;
    const f = fp.cells[cell] ?? null;
    const given = mission[cell] !== undefined && mission[cell] !== "0" && mission[cell] !== ".";
    if (given || f === null) {
      squares.push({ cell, kind: "given", x: sx, y: sy, size: FP_CELL, opacity: 1 });
      continue;
    }
    // Чётный размер: квадрат лежит по центру ячейки на целых пикселях.
    const size = 2 * Math.round((FP_CELL * rhythmScale(dwell[cell] ?? 0)) / 2);
    const off = (FP_CELL - size) / 2;
    const opacity = Number((HEAT_MIN + (HEAT_MAX - HEAT_MIN) * (f.order / span)).toFixed(3));
    squares.push({ cell, kind: f.blot === true ? "blot" : "ink", x: sx + off, y: sy + off, size, opacity });
  }
  return { width: FP_WIDTH, height: FP_HEIGHT, squares };
}

export interface FpCaption {
  /** «Pundoku» — слева. */
  readonly left: string;
  /** «30 Sep 2026 · 8:14 · 51 moves · clean» — справа. */
  readonly right: string;
}

const SERIF = 'ui-serif, "New York", Charter, Georgia, serif';
const SANS = 'system-ui, -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

/** Сколотый угол клетки-кляксы — как в макете (`polygon(0 0, 58% 0, 100% 42%, 100% 100%, 0 100%)`). */
function notchPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + s * 0.58, y);
  ctx.lineTo(x + s, y + s * 0.42);
  ctx.lineTo(x + s, y + s);
  ctx.lineTo(x, y + s);
  ctx.closePath();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + s, y, x + s, y + s, r);
  ctx.arcTo(x + s, y + s, x, y + s, r);
  ctx.arcTo(x, y + s, x, y, r);
  ctx.arcTo(x, y, x + s, y, r);
  ctx.closePath();
}

const RADIUS = 6;

export function drawFingerprint(ctx: CanvasRenderingContext2D, layout: FpLayout, caption: FpCaption): void {
  ctx.fillStyle = FP_COLORS.paper;
  ctx.fillRect(0, 0, layout.width, layout.height);
  for (const q of layout.squares) {
    if (q.kind === "given") {
      // Контур 2 px внутри ячейки (линия по центру пути — сдвиг на 1).
      ctx.lineWidth = 2;
      ctx.strokeStyle = FP_COLORS.hairline;
      roundRectPath(ctx, q.x + 1, q.y + 1, q.size - 2, RADIUS);
      ctx.stroke();
      continue;
    }
    ctx.globalAlpha = q.opacity;
    ctx.fillStyle = q.kind === "blot" ? FP_COLORS.wax : FP_COLORS.ink;
    if (q.kind === "blot") notchPath(ctx, q.x, q.y, q.size);
    else roundRectPath(ctx, q.x, q.y, q.size, RADIUS);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = FP_COLORS.label;
  ctx.font = `600 44px ${SERIF}`;
  ctx.textAlign = "left";
  const leftW = ctx.measureText(caption.left).width;
  ctx.fillText(caption.left, FP_PAD, FP_CAPTION_Y);
  // Правая часть: по возможности 32 px; не влезает — уменьшаем, но не ниже 22.
  const room = FP_GRID - leftW - 32;
  let px = 32;
  ctx.font = `400 ${px}px ${SANS}`;
  while (px > 22 && ctx.measureText(caption.right).width > room) {
    px -= 1;
    ctx.font = `400 ${px}px ${SANS}`;
  }
  ctx.fillStyle = FP_COLORS.label2;
  ctx.textAlign = "right";
  ctx.fillText(caption.right, FP_PAD + FP_GRID, FP_CAPTION_Y);
}

/** PNG отпечатка (светлый, 1080×1350). Бросает `Error`, если canvas или `toBlob` недоступны. */
export function renderFingerprintPng(fp: TimelapseFingerprint, mission: string, caption: FpCaption): Promise<Blob> {
  const layout = fingerprintLayout(fp, mission);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("canvas 2d unavailable"));
  drawFingerprint(ctx, layout, caption);
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
  });
}

export type ShareOutcome = "shared" | "cancelled" | "downloaded";

/**
 * Отдать файл системному листу iOS (`navigator.share`). Вызывать СИНХРОННО из обработчика жеста с уже готовым
 * Blob — иначе iOS отклонит (нужна активация пользователя). Нет поддержки файлов — скачивание `<a download>`.
 */
export async function shareFingerprint(blob: Blob, fileName: string, title: string): Promise<ShareOutcome> {
  const file = new File([blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // Иная ошибка системного листа — падаем в скачивание, а не теряем результат.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return "downloaded";
}
