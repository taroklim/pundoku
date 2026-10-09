import type { ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { deskKeys } from "./deskKeys";

/**
 * PD-267: инспектор десктопа C (design/pd229-desktop.html, `renderC` → `.insp`; md §3 C) — колонка справа от поля на всю
 * высоту окна. Только в раскладке с сайдбаром (`.shell.desk`); на телефоне и компакте его нет, там прежняя колонка под полем.
 *
 * Состав — блоки-дети, а не фиксированная разметка: партия кладёт сюда время/остаток (`InspectorMeta`), строку статуса,
 * панель 3×3 с действиями (`GamePad desk`, или док подсказки на её месте) и шпаргалку клавиш (`KeyLegend`). PD-268 положит
 * сюда же карточку результата и Grid ∞ после решения — те же `DeskInspector` + свои блоки, стили колонки общие (desk-play.css),
 * компактная карточка, Grid ∞ и компакт окна (ниже 1100 × 680: действия 2 × 2, без шпаргалки) — desk-result.css.
 */
export function DeskInspector({ children, solved = false }: { children: ReactNode; solved?: boolean }) {
  const { t } = useTranslation();
  return (
    // PD-268: `solved` — партия решена: в инспекторе карточка результата (+ Grid ∞ у дня) вместо времени и панели (desk-result.css).
    <aside className={solved ? "desk-insp solved" : "desk-insp"} aria-label={t("desk.inspector")} data-testid="desk-inspector">
      {children}
    </aside>
  );
}

/**
 * Время и остаток партии (макет: «Time 03:18 / Left 34 cells»). Часы — те же, что в подписи телефона (`useClock`);
 * `null` — значения нет (загрузка, ожидание генерации): прочерк. Не live-регион: остаток озвучивает `useCellsLeftAnnouncement`.
 */
export function InspectorMeta({ clock, left }: { clock: string | null; left: number | null }) {
  const { t } = useTranslation();
  return (
    <dl className="insp-meta" data-testid="insp-meta">
      <div>
        <dt>{t("desk.time")}</dt>
        <dd className="clock" data-testid="insp-time">
          {clock ?? "—"}
        </dd>
      </div>
      <div>
        <dt>{t("desk.left")}</dt>
        <dd data-testid="insp-left">{left === null ? "—" : t("desk.cells", { count: left })}</dd>
      </div>
    </dl>
  );
}

/**
 * Шпаргалка клавиш партии (макет §2 «Клавиши видны»: стрелки, 1–9, ⇧ + цифра, F и т. д.). Сами клавиши работают и без неё
 * (PD-232). Видна от высоты окна 800 CSS px (desk-play.css), ниже — места нет, остаются чипы на действиях и `title`.
 * `fill` — в партии доступно «Заполнить кандидатами» (не Ink), `hint` — доступна подсказка (лампочка в тулбаре).
 */
export function KeyLegend({ fill, hint }: { fill: boolean; hint: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const k = deskKeys();
  const row = (keys: ReactNode, text: string, testId: string) => (
    <li data-testid={testId}>
      <span className="kk">{keys}</span>
      <span>{text}</span>
    </li>
  );
  return (
    <section className="insp-keys" aria-labelledby={id} data-testid="insp-keys">
      <h3 id={id}>{t("desk.keys.title")}</h3>
      <ul>
        {row(
          <>
            <kbd>←</kbd>
            <kbd>↑</kbd>
            <kbd>→</kbd>
            <kbd>↓</kbd>
          </>,
          t("desk.keys.move"),
          "key-move",
        )}
        {row(<kbd>1–9</kbd>, t("desk.keys.place"), "key-place")}
        {row(
          <>
            <kbd>{k.shift}</kbd>
            <kbd>1–9</kbd>
          </>,
          t("desk.keys.note"),
          "key-note",
        )}
        {fill && row(<kbd>{k.fill}</kbd>, t("desk.keys.fill"), "key-fill")}
        {hint && row(<kbd>{k.hint}</kbd>, t("desk.keys.hint"), "key-hint")}
        {row(<kbd>Esc</kbd>, t("desk.keys.deselect"), "key-esc")}
      </ul>
    </section>
  );
}
