import type { CSSProperties, KeyboardEvent } from "react";
import { memo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { digitAt, isGiven, isWrong, notesOf } from "./logic";
import type { PlaySnapshot, PlayStore } from "./store";

/** Индекс клетки по номеру блока и позиции в блоке (DOM идёт блок за блоком, как в макете). */
const idxOf = (b: number, k: number): number =>
  (3 * Math.floor(b / 3) + Math.floor(k / 3)) * 9 + (3 * (b % 3) + (k % 3));

const BOXES = Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => idxOf(b, k)));

/** Волосяные линии внутри блока (вариант B): 2 вертикальные + 2 горизонтальные, ровно 1 px @2x. */
function BoxRules() {
  return (
    <svg className="rules" viewBox="0 0 3 3" preserveAspectRatio="none" aria-hidden="true">
      {[1, 2].map((k) => (
        <g key={k}>
          <line className="thin" x1={k} y1={0} x2={k} y2={3} />
          <line className="thin" x1={0} y1={k} x2={3} y2={k} />
        </g>
      ))}
    </svg>
  );
}

interface CellProps {
  index: number;
  given: number;
  value: number;
  notes: number;
  selected: boolean;
  same: boolean;
  wrong: boolean;
  /** Ненулевой id — цифра только что поставлена (M1). */
  popId: number;
  /** Позиция в волне M3 (−1 — клетка не в волне) и id волны. */
  waveIdx: number;
  waveId: number;
  tabStop: boolean;
  label: string;
  onPick: (cell: number) => void;
}

const Cell = memo(function Cell(p: CellProps) {
  const digit = p.given || p.value;
  const cls = ["cell"];
  if (p.selected) cls.push("sel");
  if (p.same) cls.push("same");
  if (p.wrong) cls.push("err");
  // M3: волна — класс клетки, а не отдельный элемент (раньше <i key=waveId> делил ключ «0» со
  // span цифры и накапливался в DOM). Чётность id даёт два имени анимации подряд: смежные
  // волны перезапускают анимацию, не создавая ни одного узла.
  if (p.waveIdx >= 0) cls.push("wave", p.waveId % 2 ? "wave-a" : "wave-b");
  const style = p.waveIdx >= 0 ? ({ "--wi": p.waveIdx } as CSSProperties) : undefined;
  return (
    <button
      type="button"
      className={cls.join(" ")}
      style={style}
      data-i={p.index}
      tabIndex={p.tabStop ? 0 : -1}
      aria-label={p.label}
      aria-current={p.selected ? "true" : undefined}
      onFocus={() => p.onPick(p.index)}
      onClick={() => p.onPick(p.index)}
    >
      <i className="fl" aria-hidden="true" />
      {digit ? (
        <span
          key={p.popId}
          className={`d ${p.given ? "given" : "player"}${p.wrong ? " err" : ""}${p.popId ? " anim-in" : ""}`}
          aria-hidden="true"
        >
          {digit}
        </span>
      ) : p.notes ? (
        <span className="marks" aria-hidden="true">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <span key={d}>{p.notes & (1 << d) ? d : ""}</span>
          ))}
        </span>
      ) : null}
    </button>
  );
});

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

interface BoardProps {
  snap: PlaySnapshot;
  store: PlayStore;
  /** Данные гаснут до 60 % перед карточкой «решено» (M5-прелюдия, 240 мс). */
  dim: boolean;
}

/**
 * Поле B Boxes (утверждённый макет): девять блоков-карточек, зазор 4, радиус 10, hairline внутри;
 * соседи не заливаются; «та же цифра» — чернила 10 %, выбор — 16 % + кольцо (M2 — кольцо едет).
 * Доступность: одна точка табуляции (roving tabindex), стрелки двигают выбор и фокус.
 */
export function Board({ snap, store, dim }: BoardProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { play, selected, pop, wave } = snap;
  const ready = snap.phase === "playing" && play !== null;
  const selDigit = play && selected !== null ? digitAt(play, selected) : 0;
  // Roving: клетка-«единственная остановка» — выбранная (или первая, пока ничего не выбрано).
  const stop = selected ?? 0;

  // Фокус следует за выбором: undo (Ctrl+Z) и другие программные сдвиги выбора переводят
  // DOM-фокус на выбранную клетку — но только если фокус уже внутри поля (кнопки панели
  // и Undo фокус не отбирают).
  useEffect(() => {
    const board = ref.current;
    const active = document.activeElement;
    if (!board || selected === null || !active || !board.contains(active)) return;
    if ((active as HTMLElement).dataset["i"] === String(selected)) return;
    board.querySelector<HTMLElement>(`[data-i="${selected}"]`)?.focus({ preventScroll: true });
  }, [selected]);

  const pick = useCallback((cell: number) => store.select(cell), [store]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const dir = ARROWS[e.key];
    if (!dir || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const next = store.moveSelection(dir[0], dir[1]);
    if (next !== null) ref.current?.querySelector<HTMLElement>(`[data-i="${next}"]`)?.focus();
  };

  const cellLabel = (i: number): string => {
    const where = { row: Math.floor(i / 9) + 1, col: (i % 9) + 1 };
    if (!play) return t("board.cellEmpty", where);
    if (isGiven(play, i)) return t("board.cellClue", { ...where, digit: play.mission[i] });
    const v = play.values[i] ?? 0;
    if (v) return t(isWrong(play, i) ? "board.cellWrong" : "board.cellYours", { ...where, digit: v });
    const nn = notesOf(play.notes[i] ?? 0);
    if (nn.length) return t("board.cellNotes", { ...where, notes: nn.join(", ") });
    return t("board.cellEmpty", where);
  };

  const sr = selected !== null ? Math.floor(selected / 9) : 0;
  const sc = selected !== null ? selected % 9 : 0;
  const ringStyle = {
    "--r": sr,
    "--c": sc,
    "--br": Math.floor(sr / 3),
    "--bc": Math.floor(sc / 3),
  } as CSSProperties;

  const waveIndex = new Map<number, number>();
  wave?.cells.forEach((c, n) => waveIndex.set(c, n));

  return (
    <div className="board-wrap">
      <div
        ref={ref}
        className={`board${dim ? " dim" : ""}${ready ? "" : " idle"}`}
        data-phase={snap.phase}
        role="group"
        aria-label={t("board.label")}
        aria-busy={snap.phase === "loading"}
        inert={!ready}
        onKeyDown={onKeyDown}
      >
        {BOXES.map((cells, b) => (
          <div className="box" key={b}>
            {cells.map((i) => {
              const v = play?.values[i] ?? 0;
              const digit = play ? digitAt(play, i) : 0;
              return (
                <Cell
                  key={i}
                  index={i}
                  given={play?.mission[i] ?? 0}
                  value={v}
                  notes={play?.notes[i] ?? 0}
                  selected={ready && selected === i}
                  same={ready && selDigit !== 0 && selected !== i && digit === selDigit}
                  wrong={play ? isWrong(play, i) : false}
                  popId={pop && pop.cell === i ? pop.id : 0}
                  waveIdx={wave ? (waveIndex.get(i) ?? -1) : -1}
                  waveId={wave && waveIndex.has(i) ? wave.id : 0}
                  tabStop={i === stop}
                  label={cellLabel(i)}
                  onPick={pick}
                />
              );
            })}
            <BoxRules />
          </div>
        ))}
        {/* Одно кольцо, которое переезжает (M2). Монтируется сразу на месте (key по партии),
            поэтому при старте не «прилетает» из угла. */}
        {ready && selected !== null && (
          <div className="ring" key={snap.startedOn.getTime()} style={ringStyle} aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
