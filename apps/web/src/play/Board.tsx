import { litCells } from "@pundoku/engine";
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RingMark } from "../melody/game";
import { ringLifetimeMs, ringSchedule } from "../melody/game";
import { useHighlightPeers, useHighlightWrong } from "../settings/prefs";
import { LONG_PRESS_MS } from "./controls";
import { Glyph, glyphName } from "./glyphs";
import { acquittedCells, caughtLie, liarHidden } from "./liar";
import { blotsIn, digitAt, isGiven, isWrong, notesOf, peersOf } from "./logic";
import type { GameStore, PlaySnapshot } from "./gameStore";
import { MOTION_MS } from "./motion";
import type { HintMarks } from "./hintModel";
import { hintRoleOf, regionCells, regionRect } from "./hintModel";
import type { FadeTrack, FogGhost, Light } from "./lanternFade";
import { fogMotion, nextExpiry, stepFade, veilOf as veilOfLight } from "./lanternFade";

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
  /** PD-124: клетка в ряду/столбце/блоке выбранной (очень слабая заливка; настройка устройства). */
  peer: boolean;
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
  /** PD-139: метки подсказки на клетке — «где происходит» (полоса) и «почему» (кольцо); `struck` — маска вычеркнутых заметок. */
  hintStrip: boolean;
  hintRing: boolean;
  struck: number;
  tabStop: boolean;
  label: string;
  /**
   * Лжец (PD-171): подсказка оправдана (обвинили — честная), пойманная ложь (`lie` — зачёркнутая ложная цифра, `given` уже
   * истинная), `sealId` — обвинение этой клетки только что сделано (печать проявляется), `accusable` — долгое нажатие/
   * контекстное меню на клетке открывает «Обвинить». Всё это — вердикты уже сделанных обвинений, не ответ.
   */
  acquitted: boolean;
  lie: number;
  sealId: number;
  accusable: boolean;
  /** PD-194: партия режима Глифы — знаки вместо цифр (дано залитым, ваше контуром, заметки — залитые мини-знаки). */
  glyphs: boolean;
  /**
   * PD-203 (Мелодия): кольца по клетке — юниты, закрытые последней постановкой (клетка на пересечении — два кольца); `ringId` —
   * id постановки (ключ: новая постановка перезапускает кольцо). Нет — колец нет.
   */
  rings: readonly RingMark[] | undefined;
  ringId: number;
  /**
   * PD-208/PD-210/PD-216 (Фонарь, вариант C «Туман»): `lit` — клетка в свете выбранной (строка/столбец/блок); `shadow` — в тени:
   * своя цифра размыта настоящим blur (styles/lantern.css), заметки — одно размытое пятно без цифр и позиций (PD-230),
   * содержимое aria-hidden, подпись «в тени»;
   * `peek` — та же клетка тени во время осмотра (вид b: цифры видны, туман вокруг них остаётся). Подсказки — всегда как есть.
   * `null` — не Фонарь (или партия не идёт).
   */
  light: Light;
  /**
   * PD-251: слой прежнего вида клетки, ещё гаснущий после смены света (кроссфейд чёткий ↔ туман, lanternFade.ts); null — нет.
   * Чёткий призрак бывает только у клетки, которая была в свете меньше FOG_FADE_MS назад.
   */
  ghost: FogGhost | null;
  /** PD-251: свет клетки менялся после её постановки — M1 (`anim-in`) не повторять: перезапуск анимации мигнул бы. */
  popSpent: boolean;
  onAccuse?: (cell: number, el: HTMLElement) => void;
  onPick: (cell: number) => void;
  /** Нажатие на клетку: запоминаем точку касания для M7. */
  onTouch: (cell: number, x: number, y: number) => void;
}

/** Сдвиг пальца, после которого долгое нажатие на клетке считается прокруткой/жестом, а не нажатием. */
const MOVE_SLOP_PX = 10;

const Cell = memo(function Cell(p: CellProps) {
  const digit = p.given || p.value;
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Долгое нажатие открыло меню: хвост этого жеста (contextmenu iOS) — не второе открытие. */
  const fired = useRef(0);
  const stopPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => stopPress, []);
  const cls = ["cell"];
  if (p.selected) cls.push("sel");
  if (p.same) cls.push("same");
  if (p.peer) cls.push("peer");
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
  if (p.acquitted) cls.push("acquitted");
  if (p.lie) cls.push("caught");
  if (p.sealId !== 0) cls.push("sealing");
  if (p.light === "lit") cls.push("is-lit");
  else if (p.light === "shadow") cls.push("is-shadow");
  else if (p.light === "peek") cls.push("is-peek");
  // PD-216 (решение владельца): в тени своя цифра — настоящая, но размыта (styles/lantern.css, один filter на элемент); заметки —
  // одно пятно без цифр (PD-230). Содержимое aria-hidden, подпись клетки — «в тени» без цифры, поле без выделения текста.
  // PD-251: два слоя в постоянном порядке — чёткий (своя цифра / сетка заметок), затем туман (`.fog` / `.marks.spot`). Смена света
  // монтирует слой нового вида (проявляется по opacity через @starting-style), а слой прежнего вида — призрак `ghost` — гаснет
  // классом `fading` и через FOG_FADE_MS убирается. Быстрая смена туда-обратно возвращает тот же элемент (переход разворачивается
  // с текущей прозрачности, без мигания). Анимируется только opacity, blur — никогда. Подсказка — как есть.
  const fog = p.light === "shadow" && !p.given;
  const g = p.given ? null : p.ghost;
  const showClear = !fog || g?.veil === "clear";
  const showFog = fog || g?.veil === "fog";
  const clearOut = fog; // чёткий слой в клетке тени — только гаснущий призрак
  const fogOut = !fog;
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
        stopPress();
        if (!p.accusable || !p.onAccuse || e.button !== 0) return;
        const el = e.currentTarget;
        // Лжец: долгое нажатие на подсказку — контекстное меню «Обвинить» (визуал v2 п. 6), не мгновенное действие.
        press.current = {
          timer: window.setTimeout(() => {
            press.current = null;
            fired.current = Date.now();
            p.onAccuse?.(p.index, el);
          }, LONG_PRESS_MS),
          x: e.clientX,
          y: e.clientY,
        };
      }}
      onPointerMove={(e) => {
        const pr = press.current;
        if (pr && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > MOVE_SLOP_PX) stopPress();
      }}
      onPointerUp={stopPress}
      onPointerLeave={stopPress}
      onPointerCancel={stopPress}
      onContextMenu={(e) => {
        // iOS/Android отдают долгий тап и как contextmenu; мышь — правой кнопкой; клавиатура — клавишей меню/Shift+F10.
        if (!p.accusable || !p.onAccuse) return;
        e.preventDefault();
        stopPress();
        if (Date.now() - fired.current < 1500) return; // меню уже открыто таймером
        fired.current = Date.now();
        p.onAccuse(p.index, e.currentTarget);
      }}
      onFocus={() => p.onPick(p.index)}
      onClick={() => p.onPick(p.index)}
    >
      <i className="fl" aria-hidden="true" />
      {p.hintStrip && <i className="hint-strip" aria-hidden="true" />}
      {p.hintRing && <i className="hint-ring" aria-hidden="true" />}
      {p.rings?.map((r, k) => (
        <i key={`m${p.ringId}-${k}`} className="mring" style={{ "--mu": r.unitMs, "--mi": r.step } as CSSProperties} aria-hidden="true" data-testid="mring" />
      ))}
      {p.blot && <i key={`s${p.blotId}`} className={`stain${p.blotId ? " anim" : ""}`} aria-hidden="true" />}
      {(p.acquitted || p.lie !== 0) && <i key={`w${p.sealId}`} className={`seal${p.sealId ? " anim" : ""}`} aria-hidden="true" />}
      {p.lie !== 0 && (
        <span className="lie" aria-hidden="true">
          {p.lie}
        </span>
      )}
      {p.blotId !== 0 && p.wrongDigit !== 0 && (
        <span className={`d player wrong leaving${p.glyphs ? " gd" : ""}`} aria-hidden="true">
          {p.glyphs ? <Glyph digit={p.wrongDigit} kind="placed" /> : p.wrongDigit}
        </span>
      )}
      {digit
        ? showClear && (
            <span
              key={p.popId || p.blotId}
              className={`d ${p.given ? "given" : "player"}${p.glyphs ? " gd" : ""}${(clearOut ? g?.err : p.wrong) ? " err" : ""}${(clearOut ? g?.peek : p.light === "peek") ? " pk" : ""}${p.popId && !clearOut && !p.popSpent ? " anim-in" : ""}${p.blotId && !clearOut ? " swap-in" : ""}${clearOut ? " fading" : ""}`}
              aria-hidden="true"
            >
              {p.glyphs ? <Glyph digit={digit} kind={p.given ? "given" : "placed"} /> : digit}
            </span>
          )
        : p.notes
          ? showClear && (
              <span key="m" className={`marks${p.glyphs ? " gl-marks" : ""}${clearOut ? " fading" : ""}`} aria-hidden="true">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                  <span key={d} className={p.struck & (1 << d) ? "struck" : undefined}>
                    {p.notes & (1 << d) ? (p.glyphs ? <Glyph digit={d} kind="note" /> : d) : ""}
                  </span>
                ))}
              </span>
            )
          : null}
      {digit && !p.given
        ? showFog && (
            <span key="sh" className={`d player${p.glyphs ? " gd" : ""} fog${fogOut ? " fading" : ""}`} aria-hidden="true">
              {p.glyphs ? <Glyph digit={digit} kind="placed" /> : digit}
            </span>
          )
        : !digit && p.notes
          ? // PD-230 (QA PD-211): заметки в тени — одно пятно «клетка с заметками» по центру, без элемента на цифру. Размытая сетка
            // 3×3 выдавала одиночную заметку по месту пятна (blur 0,11 клетки < шага ⅓); пятно одинаково при любом наборе и числе
            // заметок (и после Fill candidates), а в DOM нет ни цифр, ни их позиций/классов.
            showFog && <span key="msh" className={`marks spot${fogOut ? " fading" : ""}`} aria-hidden="true" />
          : null}
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

/** Слой области подсказки: геометрия — через те же переменные, что у кольца выбора (`--s`, `--box-gap`). */
function HintArea({ region, tone }: { region: NonNullable<HintMarks["region"]>; tone: HintMarks["tone"] }) {
  const g = regionRect(region);
  const style = { "--r": g.r, "--c": g.c, "--br": g.br, "--bc": g.bc, "--w": g.w, "--h": g.h, "--gx": g.gx, "--gy": g.gy } as CSSProperties;
  return (
    <div className={`hint-area ${tone}`} style={style} aria-hidden="true" data-testid="hint-area" data-kind={region.kind} data-index={region.index}>
      <svg>
        <rect x="0" y="0" width="100%" height="100%" rx="6" ry="6" />
      </svg>
    </div>
  );
}

interface BoardProps {
  snap: PlaySnapshot;
  store: Pick<GameStore, "select" | "moveSelection">;
  /** Данные гаснут до 60 % перед карточкой «решено» (M5-прелюдия, 240 мс). */
  dim: boolean;
  /** PD-139: метки открытой подсказки (область, клетки шага, вычёркивания); нет — поле как обычно. */
  hintMarks?: HintMarks | null;
  /** PD-171 (Лжец): долгое нажатие на обвиняемую подсказку — открыть меню «Обвинить» у этой клетки. Нет — жеста нет (Today). */
  onAccuse?: (cell: number, el: HTMLElement) => void;
  /** PD-171: можно ли обвинить клетку (необвинённая подсказка, лжец не пойман). */
  canAccuse?: (cell: number) => boolean;
  /** PD-189: слой поверх поля (панель ожидания генерации Play) — в `.board-wrap`, центр по квадрату поля. */
  overlay?: ReactNode;
  /** PD-208 (Фонарь): «Осмотреть доску» включено из меню ⋯ — свет на всём поле, пока не выключат. */
  inspect?: boolean;
  /** PD-210: тап по полю во время осмотра из меню — осмотр заканчивается (макет PD-209 §5); тап при этом выбирает клетку. */
  onInspectEnd?: () => void;
  /** PD-210: удержание началось/закончилось — экран меняет чип и строку статуса. */
  onHoldChange?: (held: boolean) => void;
}

/** PD-208/PD-210: удержание на поле дольше этого (мс) — «осмотр доски»; 0,45 с — макет PD-209 §5 (решение PM): короче системного
 *  long press, обычный тап заметно короче. */
export const INSPECT_HOLD_MS = 450;

/**
 * PD-208: «осмотр доски» удержанием. Палец/мышь на поле дольше `INSPECT_HOLD_MS` — свет на всём поле, пока держишь; отпустил —
 * обратно. Сдвиг до срабатывания больше `MOVE_SLOP_PX` — это не удержание. Осмотр не переносит фонарь на клетку под пальцем:
 * клик отпускания глотается, а выбор, который браузер успел сдвинуть фокусом на нажатии (chromium/desktop webkit), `onHold`
 * возвращает на клетку до нажатия. Обычный тап до порога — как всегда, выбирает клетку.
 */
function useInspectHold(enabled: boolean, onHold: () => void) {
  const [held, setHeld] = useState(false);
  const press = useRef<{ timer: number; x: number; y: number; id: number } | null>(null);
  const swallow = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);
  const end = useCallback(() => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    cleanup.current?.();
    cleanup.current = null;
    setHeld(false);
  }, []);
  useEffect(() => end, [end]);
  useEffect(() => {
    if (!enabled) end();
  }, [enabled, end]);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    swallow.current = false;
    if (!enabled || e.button !== 0 || e.isPrimary === false) return;
    end();
    const id = e.pointerId;
    press.current = {
      timer: window.setTimeout(() => {
        if (!press.current) return;
        window.clearTimeout(press.current.timer);
        swallow.current = true;
        setHeld(true);
        onHold();
      }, INSPECT_HOLD_MS),
      x: e.clientX,
      y: e.clientY,
      id,
    };
    // Отпускание ловим на window: палец может уйти с поля, а тач неявно захвачен клеткой.
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === id) end();
    };
    const move = (ev: PointerEvent) => {
      const pr = press.current;
      if (pr && ev.pointerId === id && !swallow.current && Math.hypot(ev.clientX - pr.x, ev.clientY - pr.y) > MOVE_SLOP_PX) end();
    };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("blur", end);
    cleanup.current = () => {
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("blur", end);
    };
  };
  const onClickCapture = (e: { stopPropagation: () => void; preventDefault: () => void }) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.stopPropagation();
    e.preventDefault();
  };
  const onContextMenu = (e: { preventDefault: () => void }) => {
    // Долгий тап Android/правая кнопка мыши — не системное меню поверх осмотра.
    if (enabled) e.preventDefault();
  };
  return { held: enabled && held, onPointerDown, onClickCapture, onContextMenu };
}

/**
 * Поле B Boxes (утверждённый макет): девять блоков-карточек, зазор 4, радиус 10, hairline внутри;
 * ряд/столбец/блок выбранной клетки — чернила ≈3 % (PD-124, по умолчанию вкл, выключатель в Settings; в PD-7 «соседи не
 * заливаются» — решение владельца 6.4 это пересмотрело); «та же цифра» — чернила 10 %, выбор — 16 % + кольцо (M2 — кольцо едет).
 * Доступность: одна точка табуляции (roving tabindex), стрелки двигают выбор и фокус.
 */
export function Board({ snap, store, dim, hintMarks = null, onAccuse, canAccuse, overlay, inspect = false, onInspectEnd, onHoldChange }: BoardProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const { play, selected, pop } = snap;
  // PD-112: подсветка неверной цифры в обычной партии — настройка устройства, по умолчанию выкл. Ink (клякса) от неё не
  // зависит: там ошибка всегда видна (и озвучена) по правилам режима.
  const highlightWrong = useHighlightWrong();
  const showWrong = highlightWrong || play?.ink === true;
  // PD-124: заливка соседей выбранной клетки — настройка устройства (по умолчанию вкл); и в ink: это не подсказка, а ориентир.
  const highlightPeers = useHighlightPeers();
  // PD-171: в Лжеце до поимки ошибок по решению не показываем вовсе — цифра, выведенная из лжи, выдала бы лжеца.
  const wrongAt = (p: NonNullable<typeof play>, i: number) => showWrong && !liarHidden(p) && isWrong(p, i);
  // M3/M8/M7: события живут ровно столько, сколько играет анимация.
  const wave = useMoment(snap.wave, MOTION_MS.wave);
  const echo = useMoment(snap.echo, MOTION_MS.echo);
  // M7: точка касания последней нажатой клетки — откуда пятно расходится.
  const [touch, setTouch] = useState<{ cell: number; x: number; y: number } | null>(null);
  const onTouch = useCallback((cell: number, x: number, y: number) => setTouch({ cell, x, y }), []);
  const ready = snap.phase === "playing" && play !== null;
  // Ink (PD-74): клетки-кляксы — из лога (единственный источник); клякса инертна — «той же цифры» из неё не берём.
  const blotCells = useMemo(() => new Set(play?.ink === true ? blotsIn(play).map((b) => b.cell) : []), [play]);
  const peers = useMemo(() => (highlightPeers && selected !== null ? new Set(peersOf(selected)) : null), [highlightPeers, selected]);
  const selDigit = play && selected !== null && !blotCells.has(selected) ? digitAt(play, selected) : 0;
  const blotNow = useMoment(snap.blot ?? null, BLOT_MOMENT_MS, true);
  // Лжец (PD-171): вердикты уже сделанных обвинений и пойманная ложь — только они, не секрет партии.
  const acquitted = useMemo(() => (play ? acquittedCells(play) : new Set<number>()), [play]);
  const caught = play ? caughtLie(play) : null;
  const sealNow = useMoment(snap.accusation ?? null, MOTION_MS.seal);
  // PD-203: кольцо по юнитам, закрытым постановкой в Мелодии (в такт арпеджио), живёт, пока идёт; без звука — тоже.
  const cue = snap.melodyCue ?? null;
  const ringNow = useMoment(cue && cue.units.length > 0 ? cue : null, cue ? ringLifetimeMs(cue.units) : 0);
  const rings = useMemo(() => (ringNow ? ringSchedule(ringNow.units) : null), [ringNow]);
  // Roving: клетка-«единственная остановка» — выбранная (или первая, пока ничего не выбрано).
  const stop = selected ?? 0;
  // PD-208 (Фонарь): свет — строка/столбец/блок выбранной клетки (`litCells`); нет выбора — свет пуст. Только пока партия идёт:
  // загрузка, прелюдия «решено» и карточка показывают всё. Осмотр (удержание или пункт ⋯) — свет на всём поле.
  const lantern = ready && play.lantern === true;
  // Выбор до нажатия (обработчик поля идёт до фокуса кнопки) и текущий — чтобы удержание вернуло фонарь на место.
  const selRef = useRef(selected);
  selRef.current = selected;
  const beforePress = useRef<number | null>(null);
  const hold = useInspectHold(lantern, () => {
    if (selRef.current !== beforePress.current) store.select(beforePress.current);
  });
  const showAll = !lantern || inspect || hold.held;
  const lit = useMemo(() => new Set<number>(selected !== null ? litCells(selected) : []), [selected]);
  const inShadow = (i: number): boolean => !showAll && !lit.has(i);
  // PD-210 (осмотр b): во время осмотра граница света видна — клетки тени помечены `peek` (цифры читаются, туман вокруг них).
  const lightOf = (i: number): CellProps["light"] => (!lantern ? null : lit.has(i) ? "lit" : showAll ? "peek" : "shadow");
  // PD-251: туман появляется и уходит постепенно — у клетки, сменившей свет, слой прежнего вида гаснет (призрак, lanternFade.ts).
  // Учёт — в ref (идемпотентен при повторном рендере), один таймер на всё поле снимает истёкшие призраки.
  const lights: Light[] = [];
  const sigs: number[] = [];
  const wrongs: boolean[] = [];
  for (let i = 0; i < 81; i++) {
    lights.push(lightOf(i));
    sigs.push(play && !isGiven(play, i) ? (play.values[i] ?? 0) * 1024 + (play.notes[i] ?? 0) : 0);
    wrongs.push(play && !inShadow(i) ? wrongAt(play, i) : false);
  }
  const fadeRef = useRef<FadeTrack | null>(null);
  const fade = stepFade(fadeRef.current, lights, sigs, wrongs, Date.now(), fogMotion);
  fadeRef.current = fade;
  const fadeUntil = nextExpiry(fade);
  const [, fadeTick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (fadeUntil === null) return;
    const timer = window.setTimeout(fadeTick, Math.max(0, fadeUntil - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [fadeUntil]);
  // PD-251: M1 только что поставленной цифры — пока свет её клетки не менялся; вернувшись на свет, цифра проявляется кроссфейдом.
  const popSeen = useRef<{ id: number; veil: string | null; spent: boolean }>({ id: 0, veil: null, spent: false });
  if (pop) {
    const v = veilOfLight(lights[pop.cell] ?? null);
    if (popSeen.current.id !== pop.id) popSeen.current = { id: pop.id, veil: v, spent: false };
    else if (!popSeen.current.spent && v !== popSeen.current.veil) popSeen.current = { ...popSeen.current, spent: true };
  }
  const popSpent = pop !== null && popSeen.current.id === pop.id && popSeen.current.spent;
  const holdChange = useRef(onHoldChange);
  holdChange.current = onHoldChange;
  useEffect(() => {
    holdChange.current?.(hold.held);
  }, [hold.held]);

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

  // PD-194: в Глифах подписи называют форму, а не цифру (макет PD-170: «круг, дано» / «круг, ваш» / «заметки: круг, ромб»).
  const glyphs = play?.glyphs === true;
  const hintRegion = useMemo(() => (hintMarks?.region ? new Set(regionCells(hintMarks.region)) : new Set<number>()), [hintMarks?.region]);
  const baseLabel = (i: number): string => {
    const where = { row: Math.floor(i / 9) + 1, col: (i % 9) + 1 };
    if (!play) return t("board.cellEmpty", where);
    // PD-208/PD-210: в тени подпись не называет ни цифру, ни заметки — только что клетка занята (это видно и глазами: пятно
    // тумана цифры / заметок). Пустая клетка в тени — «пусто», как на экране (макет PD-209 §2 п. 9). Подсказка — как обычно.
    if (inShadow(i) && !isGiven(play, i)) {
      if (play.values[i]) return t("lantern.cellShadow", where);
      if (play.notes[i]) return t("lantern.cellShadowNotes", where);
    }
    if (caught && caught.cell === i) return t("liar.cellCaught", { ...where, digit: play.mission[i], lie: caught.lie });
    if (acquitted.has(i)) return t("liar.cellAcquitted", { ...where, digit: play.mission[i] });
    if (glyphs) {
      // Режимы не комбинируются (Лжец/Чернила × Глифы нет) — ветки Лжеца и кляксы выше/ниже до глифов не доходят.
      if (isGiven(play, i)) return t("glyphs.cellClue", { ...where, shape: glyphName(t, play.mission[i] ?? 0) });
      const gv = play.values[i] ?? 0;
      if (gv) return t(wrongAt(play, i) ? "glyphs.cellWrong" : "glyphs.cellYours", { ...where, shape: glyphName(t, gv) });
      const gn = notesOf(play.notes[i] ?? 0);
      if (gn.length) return t("board.cellNotes", { ...where, notes: gn.map((d) => glyphName(t, d)).join(", ") });
      return t("board.cellEmpty", where);
    }
    if (isGiven(play, i)) {
      const clue = t("board.cellClue", { ...where, digit: play.mission[i] });
      return ready && onAccuse && canAccuse?.(i) ? `${clue}, ${t("liar.cellAccuseHint")}` : clue;
    }
    if (blotCells.has(i)) return t("ink.cellBlot", { ...where, digit: play.values[i] ?? 0 });
    const v = play.values[i] ?? 0;
    if (v) return t(wrongAt(play, i) ? "board.cellWrong" : "board.cellYours", { ...where, digit: v });
    const nn = notesOf(play.notes[i] ?? 0);
    if (nn.length) return t("board.cellNotes", { ...where, notes: nn.join(", ") });
    return t("board.cellEmpty", where);
  };
  // PD-139: хвост подписи — роль клетки в подсказке; координаты и значение читаются первыми.
  const cellLabel = (i: number): string => {
    const role = hintRoleOf(hintMarks, i, hintRegion);
    return role ? `${baseLabel(i)}, ${t(`hint.cellTail.${role}`)}` : baseLabel(i);
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
        className={`board${dim ? " dim" : ""}${ready ? "" : " idle"}${lantern ? " lantern" : ""}${lantern && showAll ? " inspecting" : ""}`}
        data-phase={snap.phase}
        data-lantern={lantern ? (showAll ? "inspect" : selected === null ? "dark" : "lit") : undefined}
        role="group"
        aria-label={lantern && showAll ? `${t("board.label")}, ${t("lantern.inspecting")}` : t("board.label")}
        aria-busy={snap.phase === "loading"}
        inert={!ready}
        onKeyDown={onKeyDown}
        onPointerDown={
          lantern
            ? (e) => {
                beforePress.current = selected;
                hold.onPointerDown(e);
              }
            : undefined
        }
        onClickCapture={
          lantern
            ? (e) => {
                hold.onClickCapture(e);
                // Отпускание удержания (клик проглочен) осмотр из меню не заканчивает; обычный тап — заканчивает.
                if (inspect && !e.isPropagationStopped()) onInspectEnd?.();
              }
            : undefined
        }
        onContextMenu={lantern ? hold.onContextMenu : undefined}
      >
        {BOXES.map((cells, b) => (
          <div className="box" key={b}>
            {cells.map((i) => {
              const v = play?.values[i] ?? 0;
              const digit = play ? digitAt(play, i) : 0;
              const shadow = inShadow(i);
              return (
                <Cell
                  key={i}
                  index={i}
                  given={play?.mission[i] ?? 0}
                  value={v}
                  notes={play?.notes[i] ?? 0}
                  selected={ready && selected === i}
                  same={ready && selDigit !== 0 && selected !== i && digit === selDigit && !blotCells.has(i) && !shadow}
                  peer={ready && peers !== null && peers.has(i)}
                  wrong={wrongs[i] ?? false}
                  blot={blotCells.has(i)}
                  blotId={blotNow && blotNow.cell === i ? blotNow.id : 0}
                  wrongDigit={blotNow && blotNow.cell === i ? blotNow.digit : 0}
                  popId={pop && pop.cell === i ? pop.id : 0}
                  waveIdx={wave ? (waveIndex.get(i) ?? -1) : -1}
                  waveId={wave && waveIndex.has(i) ? wave.id : 0}
                  echoIdx={echo && !shadow ? (echoIndex.get(i) ?? -1) : -1}
                  echoDelay={echo?.delay ?? 0}
                  echoId={echo && !shadow && echoIndex.has(i) ? echo.id : 0}
                  blotOrigin={blotNow && blotNow.cell === i && touch && touch.cell === i ? touch : null}
                  hintStrip={hintMarks?.strip.has(i) ?? false}
                  hintRing={hintMarks?.ring.has(i) ?? false}
                  struck={hintMarks?.struck.get(i) ?? 0}
                  tabStop={i === stop}
                  label={cellLabel(i)}
                  acquitted={acquitted.has(i)}
                  lie={caught && caught.cell === i ? caught.lie : 0}
                  sealId={sealNow && sealNow.cell === i ? sealNow.id : 0}
                  accusable={ready && onAccuse !== undefined && (canAccuse?.(i) ?? false)}
                  glyphs={glyphs}
                  rings={rings?.get(i)}
                  ringId={ringNow?.id ?? 0}
                  light={lights[i] ?? null}
                  ghost={fade.ghost[i] ?? null}
                  popSpent={popSpent && pop?.cell === i}
                  onAccuse={onAccuse}
                  onPick={pick}
                  onTouch={onTouch}
                />
              );
            })}
            <BoxRules />
          </div>
        ))}
        {/* PD-139: область подсказки — пунктир по периметру дома (SVG-rect), не анимируется никогда; ниже цифр и колец. */}
        {ready && hintMarks?.region && <HintArea region={hintMarks.region} tone={hintMarks.tone} />}
        {/* Одно кольцо, которое переезжает (M2). Монтируется сразу на месте (key по партии),
            поэтому при старте не «прилетает» из угла. */}
        {ready && selected !== null && (
          <div
            className={`ring${play && wrongAt(play, selected) ? " err" : ""}`}
            key={snap.startedOn.getTime()}
            style={ringStyle}
            aria-hidden="true"
          />
        )}
      </div>
      {overlay}
    </div>
  );
}
