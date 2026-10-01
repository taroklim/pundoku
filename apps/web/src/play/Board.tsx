import type { CSSProperties, KeyboardEvent } from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { blotsIn, digitAt, isGiven, isWrong, notesOf } from "./logic";
import type { GameStore, PlaySnapshot } from "./gameStore";
import { MOTION_MS } from "./motion";

/** Индекс клетки по номеру блока и позиции в блоке (DOM идёт блок за блоком, как в макете). */
const idxOf = (b: number, k: number): number =>
  (3 * Math.floor(b / 3) + Math.floor(k / 3)) * 9 + (3 * (b % 3) + (k % 3));

export const BOXES = Array.from({ length: 9 }, (_, b) => Array.from({ length: 9 }, (_, k) => idxOf(b, k)));

/** Волосяные линии внутри блока (вариант B): 2 вертикальные + 2 горизонтальные, ровно 1 px @2x. */
export function BoxRules() {
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
  /** Ink (PD-74): клетка — клякса (пятно + сколотый угол, клетка заперта; цифра в ней — верная). */
  blot: boolean;
  /** Ненулевой id — клякса только что поставлена (M7); `wrongDigit` — неверная цифра, которая на 110 мс остаётся видимой. */
  blotId: number;
  wrongDigit: number;
  /** Ненулевой id — цифра только что поставлена (M1). */
  popId: number;
  /** Расстояние от поставленной клетки в волне M3 (−1 — клетка не в волне) и id волны. */
  waveIdx: number;
  waveId: number;
  /** Позиция клетки в ответе M8 «цифра закрыта» (−1 — не участвует), пауза до ответа (мс) и id. */
  echoIdx: number;
  echoDelay: number;
  echoId: number;
  /** M7: точка касания клетки, % от её размера (откуда расходится пятно), если известна. */
  blotOrigin: { x: number; y: number } | null;
  tabStop: boolean;
  label: string;
  onPick: (cell: number) => void;
  /** Нажатие на клетку: запоминаем точку касания для M7. */
  onTouch: (cell: number, x: number, y: number) => void;
}

const Cell = memo(function Cell(p: CellProps) {
  const digit = p.given || p.value;
  const cls = ["cell"];
  if (p.selected) cls.push("sel");
  if (p.same) cls.push("same");
  if (p.wrong) cls.push("err");
  if (p.blot) cls.push("blot");
  // M3: волна — класс клетки, а не отдельный элемент (раньше <i key=waveId> делил ключ «0» со
  // span цифры и накапливался в DOM). Чётность id даёт два имени анимации подряд: смежные
  // волны перезапускают анимацию, не создавая ни одного узла.
  if (p.waveIdx >= 0) cls.push("wave", p.waveId % 2 ? "wave-a" : "wave-b");
  // M8: ответ закрытой цифры — тот же приём (чётность id → имя анимации), но на другом слое клетки (::after).
  if (p.echoIdx >= 0) cls.push("echo", p.echoId % 2 ? "echo-a" : "echo-b");
  // M7: клетка на миг вжимается в бумагу, пока идёт момент кляксы.
  if (p.blotId !== 0) cls.push("blotting");
  const vars: Record<string, string | number> = {};
  if (p.waveIdx >= 0) vars["--wi"] = p.waveIdx;
  if (p.echoIdx >= 0) {
    vars["--ei"] = p.echoIdx;
    vars["--ed"] = p.echoDelay;
  }
  if (p.blotId !== 0 && p.blotOrigin) {
    vars["--ox"] = `${p.blotOrigin.x}%`;
    vars["--oy"] = `${p.blotOrigin.y}%`;
  }
  const style = Object.keys(vars).length > 0 ? (vars as CSSProperties) : undefined;
  return (
    <button
      type="button"
      className={cls.join(" ")}
      style={style}
      data-i={p.index}
      tabIndex={p.tabStop ? 0 : -1}
      aria-label={p.label}
      aria-current={p.selected ? "true" : undefined}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
          p.onTouch(p.index, pct(((e.clientX - r.left) / r.width) * 100), pct(((e.clientY - r.top) / r.height) * 100));
        }
      }}
      onFocus={() => p.onPick(p.index)}
      onClick={() => p.onPick(p.index)}
    >
      <i className="fl" aria-hidden="true" />
      {p.blot && <i key={`s${p.blotId}`} className={`stain${p.blotId ? " anim" : ""}`} aria-hidden="true" />}
      {p.blotId !== 0 && p.wrongDigit !== 0 && (
        <span className="d player wrong leaving" aria-hidden="true">
          {p.wrongDigit}
        </span>
      )}
      {digit ? (
        <span
          key={p.popId || p.blotId}
          className={`d ${p.given ? "given" : "player"}${p.wrong ? " err" : ""}${p.popId ? " anim-in" : ""}${p.blotId ? " swap-in" : ""}`}
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

/**
 * Длина момента M7 (мс), PD-89: 0–150 неверная цифра · 150–340 пятно из точки касания · пауза 150 · 460–620 верная
 * цифра. К концу классы анимации снимаются (и стухшее событие не проигрывается заново при перерисовке).
 */
export const BLOT_MOMENT_MS = 620;

/**
 * Одноразовый момент движения: пока он идёт, возвращает событие (клетки несут классы анимации); через `ms` гаснет сам —
 * иначе стухший снапшот (волна давно прошла) при любой пересборке клетки проиграл бы анимацию заново. `interruptible` —
 * тап или клавиша в любой точке страницы завершают момент сразу (motion.md: движение можно прервать; нужно кляксе).
 */
function useMoment<T extends { id: number }>(effect: T | null | undefined, ms: number, interruptible = false): T | null {
  const [done, setDone] = useState(0);
  const id = effect?.id ?? 0;
  useEffect(() => {
    if (id === 0) return;
    const finish = () => setDone(id);
    const timer = window.setTimeout(finish, ms);
    if (interruptible) {
      window.addEventListener("pointerdown", finish, true);
      window.addEventListener("keydown", finish, true);
    }
    return () => {
      window.clearTimeout(timer);
      if (interruptible) {
        window.removeEventListener("pointerdown", finish, true);
        window.removeEventListener("keydown", finish, true);
      }
    };
  }, [id, ms, interruptible]);
  return effect && effect.id !== done ? effect : null;
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

interface BoardProps {
  snap: PlaySnapshot;
  store: Pick<GameStore, "select" | "moveSelection">;
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
  const { play, selected, pop } = snap;
  // M3/M8/M7: события живут ровно столько, сколько играет анимация.
  const wave = useMoment(snap.wave, MOTION_MS.wave);
  const echo = useMoment(snap.echo, MOTION_MS.echo);
  // M7: точка касания последней нажатой клетки — откуда пятно расходится.
  const [touch, setTouch] = useState<{ cell: number; x: number; y: number } | null>(null);
  const onTouch = useCallback((cell: number, x: number, y: number) => setTouch({ cell, x, y }), []);
  const ready = snap.phase === "playing" && play !== null;
  // Ink (PD-74): клетки-кляксы — из лога (единственный источник); клякса инертна — «той же цифры» из неё не берём.
  const blotCells = useMemo(() => new Set(play?.ink === true ? blotsIn(play).map((b) => b.cell) : []), [play]);
  const selDigit = play && selected !== null && !blotCells.has(selected) ? digitAt(play, selected) : 0;
  const blotNow = useMoment(snap.blot ?? null, BLOT_MOMENT_MS, true);
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
    if (blotCells.has(i)) return t("ink.cellBlot", { ...where, digit: play.values[i] ?? 0 });
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
  wave?.cells.forEach((c, n) => waveIndex.set(c, wave.steps?.[n] ?? n));
  const echoIndex = new Map<number, number>();
  echo?.cells.forEach((c, n) => echoIndex.set(c, n));

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
                  same={ready && selDigit !== 0 && selected !== i && digit === selDigit && !blotCells.has(i)}
                  wrong={play ? isWrong(play, i) : false}
                  blot={blotCells.has(i)}
                  blotId={blotNow && blotNow.cell === i ? blotNow.id : 0}
                  wrongDigit={blotNow && blotNow.cell === i ? blotNow.digit : 0}
                  popId={pop && pop.cell === i ? pop.id : 0}
                  waveIdx={wave ? (waveIndex.get(i) ?? -1) : -1}
                  waveId={wave && waveIndex.has(i) ? wave.id : 0}
                  echoIdx={echo ? (echoIndex.get(i) ?? -1) : -1}
                  echoDelay={echo?.delay ?? 0}
                  echoId={echo && echoIndex.has(i) ? echo.id : 0}
                  blotOrigin={blotNow && blotNow.cell === i && touch && touch.cell === i ? touch : null}
                  tabStop={i === stop}
                  label={cellLabel(i)}
                  onPick={pick}
                  onTouch={onTouch}
                />
              );
            })}
            <BoxRules />
          </div>
        ))}
        {/* Одно кольцо, которое переезжает (M2). Монтируется сразу на месте (key по партии),
            поэтому при старте не «прилетает» из угла. */}
        {ready && selected !== null && (
          <div
            className={`ring${play && isWrong(play, selected) ? " err" : ""}`}
            key={snap.startedOn.getTime()}
            style={ringStyle}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}
