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
import { MARK_SMALL_PATH } from "../brand/markPaths";
import {
  WORDMARK_BASELINE,
  WORDMARK_CELL,
  WORDMARK_CELLS,
  WORDMARK_DOKU,
  WORDMARK_RATIO,
  WORDMARK_RX,
  WORDMARK_SHIFT_X,
  WORDMARK_SHIFT_Y,
  WORDMARK_STROKE,
  WORDMARK_VIEW_H,
} from "../brand/wordmarkGeometry";
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
  /** «Pundoku» — слева; рисуется набранным текстом, только если нет `Path2D` (иначе слева вордмарк). */
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

/** Знак P4 «Девять клеток» в строке подписи (PD-102, §18.5д; PD-155): 44 px (≈ высота прописных левой подписи), нейтральный --label-2. */
export const FP_MARK = 44;
export const FP_MARK_GAP = 16;

/**
 * Знак — клеточная 16-сетка (девять клеток 3×3, зазор 1; 44 px ≥ 24 — порог клеточной версии), нейтральным цветом, не
 * чернилами: в отпечатке чернила несут данные пути, и знак не должен выглядеть поставленной клеткой. Нижний край
 * (клетка-ножка, y = 16 сетки) — на базовой линии подписи.
 * Возвращает `false`, если `Path2D` недоступен (тогда макет подписи не меняется).
 */
function drawBrandMark(ctx: CanvasRenderingContext2D): boolean {
  if (typeof Path2D === "undefined") return false;
  ctx.save();
  ctx.translate(FP_PAD, FP_CAPTION_Y - FP_MARK);
  ctx.scale(FP_MARK / 16, FP_MARK / 16);
  ctx.fillStyle = FP_COLORS.label2;
  ctx.fill(new Path2D(MARK_SMALL_PATH));
  ctx.restore();
  return true;
}

/** Вордмарк в подписи (PD-152, PD-111 §4 · 2а): высота и ширина по пропорции 614:116. */
export const FP_WORDMARK_H = 35;
export const FP_WORDMARK_W = Math.round(FP_WORDMARK_H * WORDMARK_RATIO);

/**
 * Вордмарк «Pundoku» в подписи PNG: «Pun» — 23 клетки (`roundRect` + `fill`), «doku» — рисованные буквы (`Path2D` +
 * `stroke`, штрих 22, `butt`/`round`). Одноцветный `label`: чернила в отпечатке означают путь решения, «Pun» чернилами
 * прочитался бы как ещё один поставленный квадрат — выделение «Pun» здесь держит форма клеток, а не цвет. Базовая
 * линия — на `FP_CAPTION_Y`, левый край — `x`. Нужен `Path2D`; возвращает `false`, если его нет (подпись набирается).
 */
function drawWordmark(ctx: CanvasRenderingContext2D, x: number): boolean {
  if (typeof Path2D === "undefined") return false;
  const k = FP_WORDMARK_H / WORDMARK_VIEW_H;
  ctx.save();
  // Внутренние координаты букв -> холст: масштаб k, базовая линия (WORDMARK_BASELINE во viewBox) на FP_CAPTION_Y.
  ctx.translate(x, FP_CAPTION_Y - WORDMARK_BASELINE * k);
  ctx.scale(k, k);
  ctx.translate(WORDMARK_SHIFT_X, WORDMARK_SHIFT_Y);
  ctx.fillStyle = FP_COLORS.label;
  for (const c of WORDMARK_CELLS) {
    roundRectPath(ctx, c.x, c.y, WORDMARK_CELL, WORDMARK_RX);
    ctx.fill();
  }
  ctx.strokeStyle = FP_COLORS.label;
  ctx.lineWidth = WORDMARK_STROKE;
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  for (const l of WORDMARK_DOKU) {
    ctx.save();
    ctx.translate(l.x, 0);
    ctx.stroke(new Path2D(l.d));
    ctx.restore();
  }
  ctx.restore();
  return true;
}

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
  ctx.textAlign = "left";
  const markDrawn = drawBrandMark(ctx);
  // Знак 44 px + 16 px отступ сдвигают левую подпись (PD-102, §18.5д); без Path2D всё как раньше.
  const shift = markDrawn ? FP_MARK + FP_MARK_GAP : 0;
  let leftW: number;
  if (drawWordmark(ctx, FP_PAD + shift)) {
    leftW = FP_WORDMARK_W;
  } else {
    // Нет Path2D (старый движок): подпись набранным текстом, как до PD-152.
    ctx.fillStyle = FP_COLORS.label;
    ctx.font = `600 44px ${SERIF}`;
    leftW = ctx.measureText(caption.left).width;
    ctx.fillText(caption.left, FP_PAD + shift, FP_CAPTION_Y);
  }
  // Правая часть: по возможности 32 px; не влезает — уменьшаем, но не ниже 18 (PD-139: подпись с подсказками длиннее).
  const room = FP_GRID - shift - leftW - 32;
  let px = 32;
  ctx.font = `400 ${px}px ${SANS}`;
  while (px > 18 && ctx.measureText(caption.right).width > room) {
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
