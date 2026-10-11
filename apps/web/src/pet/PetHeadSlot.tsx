import type { PetMood } from "@pundoku/engine";
import { useCallback, useLayoutEffect, useState } from "react";
import { PetBlot } from "./PetBlot";
import { PetTap } from "./PetTap";

/** Клякса в шапке — 40 pt в зоне 44 (макет PD-296, места 1 и 5). */
export const HEAD_PET_SIZE = 40;
/** Ширина зоны + зазор группы действий шапки (`.toolbar-end`, gap 8). */
const NEED = 44 + 8;
/** Зазор шапки между заголовком и группой действий (`.toolbar`, gap 12). */
const TOOLBAR_GAP = 12;

/**
 * Хватает ли кляксе места в шапке (`.toolbar` › заголовок … `.toolbar-end` › зона). Текст важнее (md PD-296 §2: «при нехватке
 * места на 320 pt + AX3 клякса уходит»): клякса стоит, только пока заголовок не обрезан и группа действий не сжата.
 * - Показана: уходит, если заголовок обрезан (многоточие), группа действий сжата или до заголовка меньше зазора шапки.
 * - Скрыта: возвращается, если свободного места между заголовком и группой действий хватает на зону 44 и зазор.
 * Нет раскладки (jsdom, ещё не в DOM) — считаем, что место есть.
 */
export function headSlotFits(zone: HTMLElement, shown: boolean): boolean {
  const end = zone.parentElement;
  const bar = end?.parentElement;
  if (!end || !bar) return true;
  const barW = bar.getBoundingClientRect().width;
  if (barW <= 0) return true;
  let titleRight = -Infinity;
  let clipped = false;
  for (const el of Array.from(bar.children)) {
    if (el === end) break;
    if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
    titleRight = Math.max(titleRight, contentRight(el));
    const text = el.matches(".title") ? el : el.querySelector<HTMLElement>(".title");
    if (text && text.scrollWidth > text.clientWidth + 1) clipped = true;
  }
  if (clipped) return false;
  // Группа действий сжата (её ширина меньше суммы целей с полями и зазорами) — кнопки налезают друг на друга. Поля у крайней
  // шестерёнки отрицательные (выравнивание по краю экрана), поэтому scrollWidth здесь не годится — считаем сами.
  if (squeezed(end)) return false;
  const free = titleRight === -Infinity ? Infinity : end.getBoundingClientRect().left - titleRight;
  return shown ? free >= TOOLBAR_GAP - 1 : free - TOOLBAR_GAP >= NEED - 1;
}

/**
 * Правый край содержимого (текста) элемента: у телефона заголовок — элемент по ширине текста, а в тулбаре десктопа C блок
 * заголовка тянется на всю свободную ширину (`flex: 1`) — там считаем по самому тексту (заголовок и подпись партии).
 */
function contentRight(el: HTMLElement): number {
  const box = el.getBoundingClientRect().right;
  if (typeof document.createRange !== "function" || typeof document.createTreeWalker !== "function") return box;
  // Только текстовые узлы: прямоугольники Range по элементу включают и рамки блочных потомков (во всю ширину блока).
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let right = -Infinity;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent?.trim()) continue;
    r.selectNodeContents(n);
    for (const x of Array.from(r.getClientRects?.() ?? [])) if (x.width > 0) right = Math.max(right, x.right);
  }
  return right === -Infinity ? box : right;
}

function squeezed(end: HTMLElement): boolean {
  const cs = getComputedStyle(end);
  const gap = parseFloat(cs.columnGap) || 0;
  let natural = 0;
  let n = 0;
  for (const el of Array.from(end.children)) {
    if (!(el instanceof HTMLElement)) continue;
    const c = getComputedStyle(el);
    if (c.display === "none") continue;
    natural += el.getBoundingClientRect().width + (parseFloat(c.marginLeft) || 0) + (parseFloat(c.marginRight) || 0);
    n++;
  }
  natural += gap * Math.max(0, n - 1);
  return end.getBoundingClientRect().width + 1 < natural;
}

/**
 * PD-298 (место 1; PD-299 подключает так же место 5 — шапку Year): клякса в группе действий шапки вкладки (`TabHeader` →
 * `actions`, первой — перед лампочкой/шестерёнкой). Тап — «Плюх». Сама уходит, когда шапке не хватает места (320 pt + AX3,
 * крупный текст uk/ru), и возвращается, когда место есть: следит за размером шапки (`ResizeObserver`).
 */
export function PetHeadSlot({ mood, testId, paused = false }: { mood: PetMood; testId?: string; paused?: boolean }) {
  const [zone, setZone] = useState<HTMLElement | null>(null);
  const [fits, setFits] = useState(true);
  const measure = useCallback(() => {
    if (zone) setFits((f) => headSlotFits(zone, f));
  }, [zone]);
  useLayoutEffect(() => {
    measure();
    const bar = zone?.parentElement?.parentElement;
    if (!bar || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    for (const el of Array.from(bar.children)) ro.observe(el);
    return () => ro.disconnect();
  }, [zone, measure]);
  // Показали/скрыли — перемерить ещё раз (раскладка шапки изменилась от самой зоны).
  useLayoutEffect(measure, [fits, measure]);
  return (
    <PetTap className="pet-head" testId={testId} zoneRef={setZone} hidden={!fits}>
      <PetBlot mood={mood} size={HEAD_PET_SIZE} idle={!paused} />
    </PetTap>
  );
}
