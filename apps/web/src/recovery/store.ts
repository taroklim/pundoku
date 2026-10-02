/**
 * Состояние блока «Ключ восстановления» (PD-27, макет `design/pd27-settings.html`, состояния 1–9). Хранилище в стиле
 * остальных (`subscribe/getSnapshot`), без React — поэтому логика проверяется тестами без DOM.
 *
 * Правила безопасности:
 *  - ключ (показанный или вводимый) живёт ТОЛЬКО в памяти этого объекта: не в IndexedDB/localStorage, не в адресе,
 *    не в логах (модуль не пишет в консоль). Показанный ключ стирается по «Ключ сохранён» или при уходе с экрана
 *    через подтверждение; вводимый — при закрытии экрана и после успеха;
 *  - замена ключа отложенная (PD-126): «Перевыпустить» кладёт на сервер НОВЫЙ ключ как ожидающий, старый продолжает
 *    работать; новый вступает в силу только по «Ключ сохранён» (confirm). `pendingId` (метка подтверждения) — тоже
 *    только в памяти. Закрыли/ушли/пропала сеть до подтверждения — ничего не потеряно: старый ключ жив, а в карточке
 *    «Ключ создан» остаётся статус «Новый ключ не подтверждён» (`pending`) с действиями «начать заново»/«отменить»;
 *  - токен устройства не меняется. После redeem/unlink/удаления вызывается `resetAfterLinkChange()` менеджера
 *    синхронизации (сброс серверного состояния и новая первая синхронизация), а не `adoptToken`.
 */
import type { RecoveryApi, RecoveryResult } from "./api";
import { compactKey, isCompleteKey, normalizeKeyInput } from "./key";

export type KeyPhase = "loading" | "unavailable" | "none" | "shown" | "created" | "enter";
export type SheetId = "reissue" | "unlink" | "delete" | "leave";
export type ErrorKind = "invalid" | "limit" | "offline" | "generic" | "stale";

export interface RecoveryError {
  kind: ErrorKind;
  /** Для `limit`: сколько минут ждать (округлено вверх, минимум 1). */
  minutes?: number;
}

export interface RecoveryState {
  phase: KeyPhase;
  devices: number;
  /** ISO-время создания ключа (`GET /api/recovery`). */
  createdAt: string | null;
  /** Ключ, показанный один раз (только фаза `shown`), с дефисами. */
  shownKey: string | null;
  /** Что за ключ показан: первый (`create`) или замена (`replace`, ещё не подтверждена на сервере). */
  shownMode: "create" | "replace";
  /** Метка подтверждения показанной замены (только `replace`, только в памяти). */
  pendingId: string | null;
  /** Неподтверждённая замена на сервере: старый ключ ещё работает. `expiresAt` — ISO-время, когда она протухнет. */
  pending: { expiresAt: string } | null;
  /** Строка «Новый ключ действует» над карточкой состояния (после подтверждения замены). */
  replaced: boolean;
  /** «Скопировано» на 2.2 с. */
  copied: boolean;
  /** Содержимое поля ввода (нормализованное, с дефисами). */
  entry: string;
  /** Идёт запрос (проверка ключа, создание, отвязка…). */
  busy: boolean;
  error: RecoveryError | null;
  /** Строка «Прогресс восстановлен» над карточкой состояния. */
  restored: boolean;
  sheet: SheetId | null;
}

/** Что нужно от менеджера синхронизации (`SyncManager` реализует оба метода). */
export interface RecoverySync {
  ensureToken(revalidate?: boolean): Promise<string | null>;
  resetAfterLinkChange(): Promise<boolean>;
}

export interface RecoveryDeps {
  api: RecoveryApi;
  sync: RecoverySync;
  now?: () => number;
  /** Копирование в буфер; по умолчанию `navigator.clipboard.writeText`. Отказ — «Скопировано» не показывается. */
  writeClipboard?: (text: string) => Promise<void>;
}

export const COPIED_MS = 2200;

const initial: RecoveryState = {
  phase: "loading",
  devices: 0,
  createdAt: null,
  shownKey: null,
  shownMode: "create",
  pendingId: null,
  pending: null,
  replaced: false,
  copied: false,
  entry: "",
  busy: false,
  error: null,
  restored: false,
  sheet: null,
};

export class RecoveryStore {
  private snap: RecoveryState = initial;
  private listeners = new Set<() => void>();
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLeave: (() => void) | null = null;
  /** Откуда открыт ввод ключа: «Отмена» возвращает туда же (PD-121d). */
  private entryFrom: "none" | "unavailable" = "none";  private readonly now: () => number;
  private readonly writeClipboard: (text: string) => Promise<void>;

  constructor(private readonly deps: RecoveryDeps) {
    this.now = deps.now ?? Date.now;
    this.writeClipboard =
      deps.writeClipboard ??
      ((text) => (typeof navigator !== "undefined" && navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error("no clipboard"))));
  }

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly getSnapshot = (): RecoveryState => this.snap;

  private set(patch: Partial<RecoveryState>): void {
    const was = this.snap.shownKey !== null;
    this.snap = { ...this.snap, ...patch };
    this.syncUnloadGuard(was);
    this.listeners.forEach((fn) => fn());
  }

  // ---- страница закрывается, пока ключ показан и не подтверждён ------------------------------

  private onBeforeUnload = (event: BeforeUnloadEvent): void => {
    event.preventDefault();
  };

  private syncUnloadGuard(was: boolean): void {
    const now = this.snap.shownKey !== null;
    if (was === now || typeof window === "undefined") return;
    if (now) window.addEventListener("beforeunload", this.onBeforeUnload);
    else window.removeEventListener("beforeunload", this.onBeforeUnload);
  }

  // ---- экран открыт/закрыт -------------------------------------------------------------------

  /** Экран Settings открылся: сброс разовых сообщений и свежий статус с сервера (пока висит прежний — без мерцания). */
  open(): void {
    this.set({ restored: false, replaced: false, error: null, sheet: null });
    void this.refresh();
  }

  /** Экран закрылся: введённый ключ стирается; показанный (ещё не подтверждённый) остаётся в памяти до возврата. */
  close(): void {
    this.pendingLeave = null;
    this.clearLimitTimer();
    const patch: Partial<RecoveryState> = { sheet: null, error: null, restored: false, replaced: false, entry: "" };
    if (this.snap.phase === "enter") patch.phase = this.entryFrom;
    this.set(patch);
  }

  /** Сбросить всё (тесты). */
  reset(): void {
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = null;
    this.clearLimitTimer();
    this.pendingLeave = null;
    this.set({ ...initial });
  }

  // ---- сервер ----------------------------------------------------------------------------------

  /** Вызов с токеном устройства; на 401 — перерегистрация устройства и один повтор. */
  private async call<T>(fn: (token: string) => Promise<RecoveryResult<T>>): Promise<RecoveryResult<T>> {
    let token = await this.deps.sync.ensureToken();
    if (!token) return { kind: "network" };
    let r = await fn(token);
    if (r.kind === "unauthorized") {
      token = await this.deps.sync.ensureToken(true);
      if (!token) return { kind: "network" };
      r = await fn(token);
    }
    return r;
  }

  private errorOf(r: RecoveryResult<unknown>): RecoveryError {
    switch (r.kind) {
      case "network":
        return { kind: "offline" };
      case "invalid_key":
        return { kind: "invalid" };
      case "stale_rotation":
        return { kind: "stale" };
      case "rate_limited":
        return { kind: "limit", minutes: Math.max(1, Math.ceil((r.retryAfterSec ?? 3600) / 60)) };
      default:
        return { kind: "generic" };
    }
  }

  private armLimit(r: RecoveryResult<unknown>): void {
    this.clearLimitTimer();
    if (r.kind !== "rate_limited") return;
    const ms = (r.retryAfterSec ?? 3600) * 1000;
    this.limitTimer = setTimeout(() => {
      this.limitTimer = null;
      if (this.snap.error?.kind === "limit") this.set({ error: null });
    }, ms);
  }

  private clearLimitTimer(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
  }

  /** Прочитать состояние ключа с сервера (`GET /api/recovery`). Не трогает показ ключа и поле ввода. */
  async refresh(): Promise<void> {
    if (this.snap.busy) return;
    const r = await this.call((t) => this.deps.api.status(t));
    const { phase } = this.snap;
    if (phase === "shown" || phase === "enter" || this.snap.busy) return;
    if (r.kind !== "ok") {
      if (phase === "loading") this.set({ phase: "unavailable" });
      return;
    }
    const s = r.value;
    this.set(
      s.hasKey
        ? { phase: "created", devices: s.devices, createdAt: s.keyCreatedAt, pending: s.pendingRotation }
        : { phase: "none", devices: 0, createdAt: null, pending: null },
    );
  }

  /** «Повторить» на экране «не удалось проверить». */
  retryStatus(): void {
    this.set({ phase: "loading" });
    void this.refresh();
  }

  // ---- создание и подтверждение ---------------------------------------------------------------

  async create(): Promise<void> {
    if (this.snap.busy) return;
    this.set({ busy: true, error: null, restored: false });
    const r = await this.call((t) => this.deps.api.create(t));
    if (r.kind === "ok") {
      this.set({
        busy: false,
        phase: "shown",
        shownKey: r.value.key,
        shownMode: "create",
        pendingId: null,
        pending: null,
        copied: false,
        devices: r.value.devices,
        createdAt: new Date(this.now()).toISOString(),
      });
      return;
    }
    this.armLimit(r);
    this.set({ busy: false, error: r.kind === "key_exists" ? null : this.errorOf(r) });
    if (r.kind === "key_exists") await this.refresh(); // ключ у устройства уже есть (другая вкладка) — показать как есть
  }

  /**
   * «Ключ сохранён». Первый ключ: стирается из памяти, дальше — карточка «Ключ создан». Замена (PD-126): сначала сервер
   * подтверждает переключение (старый ключ → мёртв, новый → рабочий), и только потом ключ стирается; при ошибке сети
   * или лимите ключ остаётся на экране, чтобы нажать ещё раз — старый ключ всё это время жив.
   */
  async confirmSaved(): Promise<void> {
    const { phase, shownMode, pendingId, busy } = this.snap;
    if (phase !== "shown" || busy) return;
    if (shownMode === "create" || pendingId === null) {
      this.eraseShown({});
      return;
    }
    this.set({ busy: true, error: null });
    const r = await this.call((t) => this.deps.api.confirmRotation(t, pendingId));
    if (r.kind === "ok") {
      this.eraseShown({ busy: false, pending: null, replaced: true, createdAt: new Date(this.now()).toISOString() });
      void this.refresh(); // число устройств и «Создан» — как их видит сервер
      return;
    }
    if (r.kind === "stale_rotation" || r.kind === "no_key") {
      // Замены уже нет (отменена, затёрта другим устройством, истекла) — показанный ключ бесполезен, рабочий не менялся.
      this.eraseShown({ busy: false, pending: null, error: r.kind === "stale_rotation" ? { kind: "stale" } : null });
      void this.refresh();
      return;
    }
    this.armLimit(r);
    this.set({ busy: false, error: this.errorOf(r) });
  }

  /** Стереть показанный ключ из памяти и перейти к карточке «Ключ создан». */
  private eraseShown(patch: Partial<RecoveryState>): void {
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = null;
    this.set({ phase: "created", shownKey: null, pendingId: null, copied: false, ...patch });
  }

  /** «Отменить замену»: ожидающий ключ отброшен на сервере, рабочий не тронут. */
  async cancelPending(): Promise<void> {
    if (this.snap.busy || this.snap.phase !== "created") return;
    this.set({ busy: true, error: null });
    const r = await this.call((t) => this.deps.api.cancelRotation(t));
    if (r.kind !== "ok") {
      this.armLimit(r);
      this.set({ busy: false, error: this.errorOf(r) });
      return;
    }
    this.set({ busy: false, pending: null });
  }

  async copy(): Promise<void> {
    const key = this.snap.shownKey;
    if (key === null) return;
    try {
      await this.writeClipboard(key);
    } catch {
      return; // буфер недоступен — не обещаем «Скопировано»
    }
    if (this.snap.shownKey === null) return;
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.set({ copied: true });
    this.copyTimer = setTimeout(() => {
      this.copyTimer = null;
      this.set({ copied: false });
    }, COPIED_MS);
  }

  // ---- ввод ключа ------------------------------------------------------------------------------

  /**
   * PD-121(d): «У меня уже есть ключ» доступна и когда статус не проверился (`unavailable`) — ошибка придёт при «Восстановить»,
   * а не молчаливым исчезновением пути. Откуда зашли — туда и возвращает «Отмена».
   */
  startEntry(): void {
    this.clearLimitTimer();
    const from = this.snap.phase;
    this.entryFrom = from === "unavailable" ? "unavailable" : "none";
    this.set({ phase: "enter", entry: "", error: null, restored: false });
  }

  cancelEntry(): void {
    this.clearLimitTimer();
    const back = this.entryFrom;
    this.set({ phase: back, entry: "", error: null });
    // Статус при входе в ввод не проверялся — перепроверяем, чтобы вернуться на верную карточку.
    if (back === "unavailable") this.retryStatus();
  }

  setEntry(raw: string): void {
    const entry = normalizeKeyInput(raw);
    // «Неверный ключ» и «нет сети» снимаются правкой; лимит держится, пока не пройдёт время.
    const keep = this.snap.error?.kind === "limit" ? this.snap.error : null;
    this.set({ entry, error: keep });
  }

  /** Лимит попыток действует: «Восстановить» заблокирована, поле остаётся доступным. */
  get blocked(): boolean {
    return this.snap.error?.kind === "limit";
  }

  async submit(): Promise<void> {
    const { entry, busy } = this.snap;
    if (busy || this.blocked || this.snap.phase !== "enter" || !isCompleteKey(entry)) return;
    this.set({ busy: true, error: null });
    const r = await this.call((t) => this.deps.api.redeem(t, compactKey(entry)));
    if (r.kind !== "ok") {
      this.armLimit(r);
      this.set({ busy: false, error: this.errorOf(r) });
      return;
    }
    this.set({ entry: "" }); // ключ больше не нужен даже в поле
    // Токен тот же; слияние снапшота группы с локальными днями — в менеджере синхронизации.
    await this.deps.sync.resetAfterLinkChange();
    const st = await this.call((t) => this.deps.api.status(t));
    const status = st.kind === "ok" ? st.value : null;
    this.set({
      busy: false,
      phase: "created",
      restored: true,
      devices: status?.hasKey ? status.devices : r.value.devices,
      createdAt: status?.hasKey ? status.keyCreatedAt : null,
      pending: status?.hasKey ? status.pendingRotation : null,
    });
  }

  // ---- action sheets ---------------------------------------------------------------------------

  openSheet(sheet: Exclude<SheetId, "leave">): void {
    if (this.snap.busy) return;
    this.set({ sheet });
  }

  closeSheet(): void {
    this.pendingLeave = null;
    this.set({ sheet: null });
  }

  /** Подтверждение открытого action sheet'а («Перевыпустить» / «Отвязать» / «Удалить ключ» / «Уйти»). */
  async confirmSheet(): Promise<void> {
    const { sheet } = this.snap;
    if (sheet === null) return;
    if (sheet === "leave") return this.confirmLeave();
    this.set({ sheet: null, busy: true, error: null });
    if (sheet === "reissue") {
      const r = await this.call((t) => this.deps.api.rotate(t));
      if (r.kind === "ok") {
        this.set({
          busy: false,
          phase: "shown",
          shownKey: r.value.key,
          shownMode: "replace",
          pendingId: r.value.pendingId,
          pending: { expiresAt: r.value.expiresAt },
          copied: false,
          replaced: false,
        });
        return;
      }
      this.armLimit(r);
      this.set({ busy: false, error: this.errorOf(r) });
      return;
    }
    const r = await this.call((t) => (sheet === "unlink" ? this.deps.api.unlink(t) : this.deps.api.remove(t)));
    if (r.kind !== "ok") {
      this.set({ busy: false, error: this.errorOf(r) });
      return;
    }
    // Устройство больше не в группе: на его токен сервер снова отдаёт свой снапшот.
    this.set({ phase: "none", devices: 0, createdAt: null, pending: null, restored: false });
    await this.deps.sync.resetAfterLinkChange();
    this.set({ busy: false });
  }

  // ---- уход с экрана при неподтверждённом ключе -------------------------------------------------

  /**
   * Любой уход из приложения-экрана (назад, вкладка) проходит здесь: пока ключ показан и не подтверждён, вместо
   * ухода — action sheet «Ключ ещё не сохранён». Иначе `proceed` вызывается сразу.
   */
  requestLeave(proceed: () => void): void {
    if (!this.guardLeave(proceed)) proceed();
  }

  /**
   * То же, но без побочного вызова: `true` — уход перехвачен (показан шит «Ключ ещё не сохранён», `proceed` вызовется
   * после подтверждения), `false` — ключ не показан, ничего не сделано и `proceed` не вызван. Нужен браузерному
   * «назад»/hashchange (PD-57): им заранее надо знать, что переход придётся откатить.
   */
  guardLeave(proceed: () => void): boolean {
    if (this.snap.phase !== "shown") return false;
    this.pendingLeave = proceed;
    this.set({ sheet: "leave" });
    return true;
  }

  private confirmLeave(): void {
    const proceed = this.pendingLeave;
    this.pendingLeave = null;
    // Осознанный уход без подтверждения: ключ стирается. Первый ключ — перевыпустить можно из карточки «Ключ создан».
    // Замена — старый ключ жив, а `pending` остаётся: в карточке виден статус «Новый ключ не подтверждён».
    this.eraseShown({ sheet: null });
    proceed?.();
  }
}
