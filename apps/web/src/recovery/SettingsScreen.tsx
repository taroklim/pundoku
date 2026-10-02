import type { ChangeEvent, KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Mark } from "../brand/Mark";
import { Wordmark } from "../brand/Wordmark";
import type { Locale } from "../i18n";
import { setLocale, SUPPORTED_LOCALES } from "../i18n";
import { setHighlightWrong, useHighlightWrong } from "../settings/prefs";
import { ActionSheet } from "./ActionSheet";
import { KEY_GROUP, keyGroups, isCompleteKey, spellGroup } from "./key";
import type { TabId } from "../shell/tabs";
import type { RecoveryError, RecoveryStore } from "./store";

/** Названия языков — на самих языках (не переводятся: человек ищет свой язык глазами). */
const NATIVE_NAMES: Record<Locale, string> = { en: "English", uk: "Українська", ru: "Русский" };

const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "aria-hidden": true } as const;
const CheckIcon = () => (
  <svg {...svg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="m4.8 12.6 4.6 4.6L19.3 7.3" />
  </svg>
);
const BangIcon = () => (
  <svg {...svg} strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.4v6.1" />
    <path d="M12 16.8h.01" />
  </svg>
);
const TriIcon = () => (
  <svg {...svg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3.6 22 20.4H2z" />
    <path d="M12 9.6v5" />
    <path d="M12 17.6h.01" />
  </svg>
);
const CopyIcon = () => (
  <svg {...svg} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8.6" y="3.4" width="12" height="14" rx="2.6" />
    <path d="M15.4 20.6H5.8a2.4 2.4 0 0 1-2.4-2.4V7.6" />
  </svg>
);
const ChevronIcon = () => (
  <svg {...svg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="chev">
    <path d="m9 5 7 7-7 7" />
  </svg>
);
const BackIcon = () => (
  <svg {...svg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

/**
 * Как в макете: «30 Sep 2026» / «30 вер. 2026» / «30 сент. 2026» — день, месяц, год.
 * ru/uk: без хвоста «г.»/«р.», который они добавляют. en: порядок «день месяц год» (en-US даёт «Sep 30, 2026»),
 * поэтому en собирается из частей en-US вручную — месяц остаётся «Sep» во всех движках (en-GB в новых ICU даёт «Sept»).
 */
export function formatCreated(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).formatToParts(date);
  if (locale === "en") {
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("day")} ${get("month")} ${get("year")}`;
  }
  return parts
    .filter((p) => !(p.type === "literal" && /\p{L}/u.test(p.value)))
    .map((p) => p.value)
    .join("")
    .trim();
}

/** Позиция курсора в отформатированном ключе после `n` значащих символов (дефис ставится между группами). */
const caretAfter = (n: number): number => (n === 0 ? 0 : n + Math.floor((n - 1) / KEY_GROUP));

interface SettingsScreenProps {
  store: RecoveryStore;
  onBack: () => void;
  /** Куда вернёт «‹» (PD-123: вкладка, с которой открыли Settings). По умолчанию — Today. */
  origin?: TabId;
  /** Открыть «How Pundoku works» (PD-120). Нет — строки справки нет (изолированные тесты экрана). */
  onOpenHelp?: () => void;
}

export const BACK_LABEL: Record<TabId, string> = { today: "settings.backLabel", play: "settings.backLabelPlay", year: "settings.backLabelYear" };

export function SettingsScreen({ store, onBack, origin = "today", onOpenHelp }: SettingsScreenProps) {
  const { t, i18n } = useTranslation();
  const s = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const locale = (i18n.resolvedLanguage ?? "en") as Locale;
  const highlightWrong = useHighlightWrong();

  useEffect(() => {
    store.open();
    return () => store.close();
  }, [store]);

  // ---- фокус: ключ показан — на группу ключа, ввод — в поле ----
  const keyRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const prevPhase = useRef(s.phase);
  useEffect(() => {
    if (prevPhase.current !== s.phase) {
      if (s.phase === "shown") keyRef.current?.focus({ preventScroll: false });
      if (s.phase === "enter") areaRef.current?.focus();
    }
    prevPhase.current = s.phase;
  }, [s.phase]);

  // ---- поле ввода: курсор не прыгает в конец, когда нормализация меняет текст посередине ----
  const caret = useRef<number | null>(null);
  const onEntry = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target;
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const atEnd = (el.selectionStart ?? el.value.length) === el.value.length;
    store.setEntry(el.value);
    caret.current = atEnd ? null : store.getSnapshot().entry === "" ? 0 : caretAfterCompact(before);
  };
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (el && caret.current !== null && document.activeElement === el) {
      const pos = Math.min(caret.current, el.value.length);
      el.setSelectionRange(pos, pos);
    }
    caret.current = null;
  }, [s.entry]);
  const onEntryKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void store.submit();
    }
  };

  // ---- язык: radiogroup, стрелки и roving tabindex ----
  const langRefs = useRef<Partial<Record<Locale, HTMLButtonElement | null>>>({});
  const onLangKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = SUPPORTED_LOCALES.indexOf(locale);
    let next: number;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (i + 1) % SUPPORTED_LOCALES.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (i - 1 + SUPPORTED_LOCALES.length) % SUPPORTED_LOCALES.length;
    else return;
    e.preventDefault();
    const id = SUPPORTED_LOCALES[next] as Locale;
    void setLocale(id);
    langRefs.current[id]?.focus();
  };

  const complete = isCompleteKey(s.entry);
  const restoreBlocked = s.busy || store.blocked || !complete;
  const err = s.error;
  const errText = (e: RecoveryError, inEntry: boolean): string => {
    switch (e.kind) {
      case "invalid":
        return t("settings.key.errKey");
      case "limit":
        return t("settings.key.errLimit", { minutes: e.minutes ?? 1 });
      case "offline":
        return inEntry ? t("settings.key.errOffline") : t("settings.key.statusFailed");
      default:
        return t("settings.key.errGeneric");
    }
  };
  const errLine = (inEntry: boolean, id?: string) =>
    err ? (
      <p className="settings-err" id={id} role="alert" data-testid="key-error" data-kind={err.kind}>
        <BangIcon />
        <span>{errText(err, inEntry)}</span>
      </p>
    ) : null;

  const groups = s.shownKey ? keyGroups(s.shownKey) : [];

  const keyBlock = (() => {
    switch (s.phase) {
      case "loading":
        return (
          <div className="settings-card">
            <p className="settings-row" role="status" data-testid="key-loading">
              <span className="settings-spin" aria-hidden="true" />
              <span className="lab">{t("settings.key.checking")}</span>
            </p>
          </div>
        );
      case "unavailable":
        return (
          <div className="settings-card" data-testid="key-unavailable">
            <p className="settings-row" role="status">
              <span className="lab">{t("settings.key.statusFailed")}</span>
            </p>
            <button type="button" className="settings-rowbtn" onClick={() => store.retryStatus()} data-testid="key-status-retry">
              {t("settings.key.retry")}
            </button>
            {/* PD-121(d): путь «у меня уже есть ключ» не прячется вместе со статусом — ошибка придёт при «Восстановить». */}
            <button type="button" className="settings-rowbtn" onClick={() => store.startEntry()} data-testid="key-have">
              {t("settings.key.haveKey")}
            </button>
          </div>
        );
      case "none":
        return (
          <>
            <div className="settings-card">
              <button type="button" className="settings-rowbtn" onClick={() => store.startEntry()} data-testid="key-have">
                {t("settings.key.haveKey")}
              </button>
            </div>
            <button type="button" className="settings-primary" aria-disabled={s.busy} aria-busy={s.busy} onClick={() => void store.create()} data-testid="key-create">
              {s.busy && <span className="settings-spin" aria-hidden="true" />}
              {t("settings.key.create")}
            </button>
            {errLine(false)}
            <p className="settings-foot">{t("settings.key.footNone")}</p>
          </>
        );
      case "shown":
        return (
          <>
            <div className="settings-card">
              <div className="settings-pad">
                <span className="settings-cap">{t("settings.key.yourKey")}</span>
                <div ref={keyRef} className="settings-keybox" role="group" aria-label={t("settings.key.keyLabel")} tabIndex={-1} data-testid="key-shown">
                  {groups.map((g, i) => (
                    <div
                      key={i}
                      className="settings-chip"
                      role="img"
                      aria-label={t("settings.key.keyGroup", { n: i + 1, total: groups.length, chars: spellGroup(g) })}
                    >
                      {g}
                    </div>
                  ))}
                </div>
                <p className="settings-hint">{t("settings.key.shownOnce")}</p>
              </div>
              <button type="button" className="settings-rowbtn" onClick={() => void store.copy()} aria-live="polite" data-testid="key-copy">
                {s.copied ? <CheckIcon /> : <CopyIcon />}
                {s.copied ? t("settings.key.copied") : t("settings.key.copy")}
              </button>
              <p className="settings-warn">
                <TriIcon />
                <span>{t("settings.key.warn")}</span>
              </p>
            </div>
            <button type="button" className="settings-primary" onClick={() => store.confirmSaved()} data-testid="key-saved">
              {t("settings.key.saved")}
            </button>
          </>
        );
      case "created":
        return (
          <>
            {s.restored && (
              <p className="settings-ok" role="status" data-testid="key-restored">
                <CheckIcon />
                <span>{t("settings.key.restored")}</span>
              </p>
            )}
            <div className="settings-card">
              <div className="settings-row">
                <span className="lab">{t("settings.key.rowCreated")}</span>
                <span className="val" data-testid="key-created">{formatCreated(s.createdAt, locale)}</span>
              </div>
              <div className="settings-row">
                <span className="lab">{t("settings.key.rowDevices")}</span>
                <span className="val" data-testid="key-devices">{s.devices}</span>
              </div>
            </div>
            <p className="settings-foot">{t("settings.key.footCreated")}</p>
            <div className="settings-card">
              <button type="button" className="settings-rowbtn" aria-disabled={s.busy} onClick={() => store.openSheet("reissue")} data-testid="key-reissue">
                {t("settings.key.reissue")}
              </button>
              <button type="button" className="settings-rowbtn" aria-disabled={s.busy} onClick={() => store.openSheet("unlink")} data-testid="key-unlink">
                {t("settings.key.unlink")}
              </button>
              <button type="button" className="settings-rowbtn destructive" aria-disabled={s.busy} onClick={() => store.openSheet("delete")} data-testid="key-delete">
                {t("settings.key.deleteKey")}
              </button>
            </div>
            {errLine(false)}
            <p className="settings-foot">{t("settings.key.footDanger")}</p>
          </>
        );
      case "enter":
        return (
          <>
            <div className="settings-card">
              <div className={`settings-pad${err?.kind === "invalid" ? " bad" : ""}`}>
                <label className="settings-cap" htmlFor="settings-key-field">
                  {t("settings.key.enterLabel")}
                </label>
                <textarea
                  ref={areaRef}
                  id="settings-key-field"
                  className="settings-ta mono"
                  rows={2}
                  value={s.entry}
                  onChange={onEntry}
                  onKeyDown={onEntryKey}
                  placeholder={t("settings.key.enterPlaceholder")}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  enterKeyHint="done"
                  aria-invalid={err?.kind === "invalid" ? true : undefined}
                  aria-describedby={err?.kind === "invalid" ? "settings-key-hint settings-key-err" : "settings-key-hint"}
                  data-testid="key-field"
                />
                <p className="settings-hint" id="settings-key-hint">
                  {t("settings.key.enterHint")}
                </p>
              </div>
              {errLine(true, "settings-key-err")}
            </div>
            <button
              type="button"
              className="settings-primary"
              aria-disabled={restoreBlocked}
              aria-busy={s.busy}
              onClick={() => {
                if (!restoreBlocked) void store.submit();
              }}
              data-testid="key-restore"
            >
              {s.busy ? (
                <>
                  <span className="settings-spin" aria-hidden="true" />
                  {t("settings.key.checking")}
                </>
              ) : err?.kind === "offline" ? (
                t("settings.key.retry")
              ) : (
                t("settings.key.restore")
              )}
            </button>
            <button type="button" className="settings-secondary" onClick={() => store.cancelEntry()} data-testid="key-cancel">
              {t("settings.key.cancel")}
            </button>
            <p className="settings-foot">{t("settings.key.footEnter")}</p>
          </>
        );
    }
  })();

  const sheet = s.sheet;
  const sheetProps =
    sheet === null
      ? null
      : sheet === "reissue"
        ? { title: t("settings.key.sheetReTitle"), message: t("settings.key.sheetReMsg"), action: t("settings.key.sheetReGo"), destructive: true, cancel: t("settings.key.cancel") }
        : sheet === "unlink"
          ? { title: t("settings.key.sheetUnTitle"), message: t("settings.key.sheetUnMsg"), action: t("settings.key.sheetUnGo"), destructive: false, cancel: t("settings.key.cancel") }
          : sheet === "delete"
            ? { title: t("settings.key.sheetDelTitle"), message: t("settings.key.sheetDelMsg"), action: t("settings.key.sheetDelGo"), destructive: true, cancel: t("settings.key.cancel") }
            : { title: t("settings.key.sheetLeaveTitle"), message: t("settings.key.sheetLeaveMsg"), action: t("settings.key.sheetLeaveGo"), destructive: true, cancel: t("settings.key.sheetLeaveStay") };

  return (
    <div className="settings" data-testid="settings-screen">
      <header className="settings-navbar">
        <button type="button" className="settings-back" onClick={onBack} aria-label={t(BACK_LABEL[origin])} data-testid="settings-back">
          <BackIcon />
          <span>{t(`tabs.${origin}`)}</span>
        </button>
      </header>

      <h1 className="settings-large">{t("settings.title")}</h1>

      <section className="settings-sec" aria-labelledby="settings-h-lang">
        <h2 className="settings-head" id="settings-h-lang">
          {t("settings.language")}
        </h2>
        <div className="settings-card" role="radiogroup" aria-labelledby="settings-h-lang" onKeyDown={onLangKey}>
          {SUPPORTED_LOCALES.map((id) => (
            <button
              key={id}
              ref={(node) => {
                langRefs.current[id] = node;
              }}
              type="button"
              role="radio"
              aria-checked={id === locale}
              tabIndex={id === locale ? 0 : -1}
              lang={id}
              className="settings-row settings-radio"
              onClick={() => void setLocale(id)}
              data-testid={`lang-${id}`}
            >
              <span className="lab">{NATIVE_NAMES[id]}</span>
              <span className="ck" aria-hidden="true">
                <CheckIcon />
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="settings-sec" aria-labelledby="settings-h-game">
        <h2 className="settings-head" id="settings-h-game">
          {t("settings.game.head")}
        </h2>
        <div className="settings-card">
          <label className="settings-row settings-switch">
            <span className="lab">{t("settings.game.highlightWrong")}</span>
            <input
              type="checkbox"
              role="switch"
              className="st-switch"
              checked={highlightWrong}
              onChange={(e) => setHighlightWrong(e.target.checked)}
              aria-describedby="settings-game-foot"
              data-testid="highlight-wrong"
            />
          </label>
        </div>
        <p className="settings-foot" id="settings-game-foot">
          {t("settings.game.highlightWrongFoot")}
        </p>
      </section>

      <section className="settings-sec" aria-labelledby="settings-h-key">
        <h2 className="settings-head" id="settings-h-key">
          {t("settings.key.head")}
        </h2>
        {keyBlock}
      </section>

      {onOpenHelp && (
        <section className="settings-sec" aria-labelledby="settings-h-help">
          <h2 className="settings-head" id="settings-h-help">
            {t("settings.helpHead")}
          </h2>
          <div className="settings-card">
            <button type="button" className="settings-rowbtn nav" onClick={onOpenHelp} data-testid="open-help">
              <span>{t("settings.helpRow")}</span>
              <ChevronIcon />
            </button>
          </div>
        </section>
      )}

      {/* About (PD-102, §18.5в): знак + вордмарк + версия — там, где о приложении спрашивают. Всё статично и декоративно. */}
      <section className="settings-sec" aria-labelledby="settings-h-about">
        <h2 className="settings-head" id="settings-h-about">
          {t("settings.about.head")}
        </h2>
        <div className="settings-card settings-about" data-testid="settings-about">
          <Mark size={60} className="settings-about-mark" />
          <Wordmark height={28} className="settings-about-word" />
          <p className="settings-about-ver" data-testid="about-version">
            <span className="sr-only">
              {t("settings.about.name")}, {t("settings.about.version", { version: __APP_VERSION__ })}
            </span>
            <span aria-hidden="true">v{__APP_VERSION__}</span>
          </p>
        </div>
      </section>

      {sheetProps && (
        <ActionSheet
          title={sheetProps.title}
          message={sheetProps.message}
          actionLabel={sheetProps.action}
          destructive={sheetProps.destructive}
          cancelLabel={sheetProps.cancel}
          onAction={() => void store.confirmSheet()}
          onCancel={() => store.closeSheet()}
        />
      )}
    </div>
  );
}

/** Значащих символов в «сыром» префиксе поля → позиция курсора в нормализованном тексте. */
function caretAfterCompact(prefixRaw: string): number {
  const n = prefixRaw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "").length;
  return caretAfter(Math.min(n, 32));
}
