/**
 * Глифы (PD-194, план режимов §3): отображение `Digit → знак` для партии режима `glyphs`. Набор **A «Фигуры»** (решение
 * владельца PD-170) — силуэты дословно из макета design/pd170-pet-glyphs.html (`P`, `SETS.A`, `glyph()`), рамка 24 ед.
 *
 * Правила отрисовки (design/pd170-pet-glyphs.md §2): дано — залитый знак (цвет `--label`), поставлено — контур (чернила,
 * штрих 1,9 ед., знак ужат до 0,9 к центру), заметки — залитые мини-знаки (`--notes`), пад — контур. Различие «дано/ваше»
 * держится формой заливки, цвет его только дублирует. Порядок «цифра → форма» намеренно НЕ по числу углов.
 *
 * Движок, лог и правила не знают о глифах: это только рендер. Цвет — `currentColor` от существующих классов клетки.
 */
import type { TFunction } from "i18next";

/** Ключ формы (часть ключа i18n `glyphs.shape.<form>`). */
export type GlyphForm = "circle" | "triangle" | "square" | "plus" | "diamond" | "dome" | "star" | "leaf" | "hourglass";

/** Набор A, пад 1 → 9 (макет `SETS.A.forms`; `disc` макета здесь — `circle`). */
export const GLYPH_FORMS: readonly GlyphForm[] = ["circle", "triangle", "square", "plus", "diamond", "dome", "star", "leaf", "hourglass"];

/** Замкнутые силуэты в рамке 24 ед. — дословно `P` макета PD-170. */
export const GLYPH_PATHS: Readonly<Record<GlyphForm, string>> = {
  circle: "M3.4 12a8.6 8.6 0 1 0 17.2 0a8.6 8.6 0 1 0-17.2 0z",
  square: "M5.8 4.4h12.4a1.4 1.4 0 0 1 1.4 1.4v12.4a1.4 1.4 0 0 1-1.4 1.4H5.8a1.4 1.4 0 0 1-1.4-1.4V5.8a1.4 1.4 0 0 1 1.4-1.4z",
  triangle: "M12 1.8L22.8 21.2H1.2z",
  diamond: "M12 1.3L22.7 12L12 22.7L1.3 12z",
  plus: "M8.4 2h7.2v6.4H22v7.2h-6.4V22H8.4v-6.4H2V8.4h6.4z",
  dome: "M0.8 17A11.2 11.2 0 0 1 23.2 17v1.6H0.8z",
  star: "M12 1.5L15.35 8.29L22.84 9.38L17.42 14.66L18.7 22.12L12 18.6L5.3 22.12L6.58 14.66L1.16 9.38L8.65 8.29z",
  leaf: "M3.5 20.5A14.75 14.75 0 0 1 20.5 3.5A14.75 14.75 0 0 1 3.5 20.5z",
  hourglass: "M3.5 2h17L13.5 12l7 10h-17l7-10z",
};

/** Форма цифры 1..9 (вне диапазона — `null`). */
export function glyphForm(digit: number): GlyphForm | null {
  return Number.isInteger(digit) && digit >= 1 && digit <= 9 ? (GLYPH_FORMS[digit - 1] ?? null) : null;
}

/** Имя формы для VoiceOver/подписей (en/uk/ru): «circle» / «коло» / «круг». */
export function glyphName(t: TFunction, digit: number): string {
  const form = glyphForm(digit);
  return form ? t(`glyphs.shape.${form}`) : String(digit);
}

/** given — залитый (дано), placed — контур (ваше), pad — контур на клавише, note — залитый мини-знак заметки. */
export type GlyphKind = "given" | "placed" | "pad" | "note";

/** Знак цифры. Декоративный (`aria-hidden`): смысл несёт подпись клетки/клавиши. */
export function Glyph({ digit, kind }: { digit: number; kind: GlyphKind }) {
  const form = glyphForm(digit);
  if (!form) return null;
  const d = GLYPH_PATHS[form];
  const outline = kind === "placed" || kind === "pad";
  return (
    <svg className={`gl gl-${kind}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-form={form}>
      {outline ? (
        <g transform="translate(12 12) scale(.9) translate(-12 -12)">
          <path className="o" d={d} />
        </g>
      ) : (
        <path className="f" d={d} />
      )}
    </svg>
  );
}
