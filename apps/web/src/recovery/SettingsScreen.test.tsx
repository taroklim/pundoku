// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import i18n from "../i18n";
import type { RecoveryApi, RecoveryResult, RecoveryStatus } from "./api";
import { formatCreated, SettingsScreen } from "./SettingsScreen";
import { HIGHLIGHT_WRONG_KEY, getHighlightWrong, setHighlightWrong } from "../settings/prefs";
import { RecoveryStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "K7QP-M2XZ-9D4T-VB6N-H3RW-8YCJ-5FGA-E0S1";
const KEY2 = "ZQ8W-4NMD-7T2X-H9RB-C5VK-1JYF-3GPE-6A0S";
const PENDING = "6f0c1d9e-1b7a-4c52-9f1a-3e5d8b2a7c10";
const EXPIRES = "2026-10-03T10:00:00.000Z";
const ok = <T,>(value: T): RecoveryResult<T> => ({ kind: "ok", value });

let host: HTMLDivElement;
let root: Root;
let store: RecoveryStore;
let api: RecoveryApi;
let resetCalls: number;
let onBack: ReturnType<typeof vi.fn>;

const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const q = <T extends Element = HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`);
const click = async (id: string) => {
  const el = q(id);
  expect(el, id).not.toBeNull();
  await act(async () => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await flush();
};
const type = async (value: string) => {
  const ta = q<HTMLTextAreaElement>("key-field")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(ta, value);
    ta.setSelectionRange(value.length, value.length);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
/** Поля проверки записи (PD-142): какие группы спросили — читаем по подписям «Group N of 8». */
const checkInputs = () => [0, 1].map((i) => q<HTMLInputElement>(`key-check-${i}`)!);
const askedGroups = () => checkInputs().map((el) => Number(host.querySelector(`label[for="${el.id}"]`)!.textContent!.match(/Group (\d)/)![1]) - 1);
const typeCheck = async (i: number, value: string) => {
  const el = checkInputs()[i]!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const groupsOf = (key: string) => key.split("-");
/** «I’ve written it down» → верные группы → «Check». */
async function writeAndCheck(key: string) {
  await click("key-saved");
  const asked = askedGroups();
  await typeCheck(0, groupsOf(key)[asked[0]!]!);
  await typeCheck(1, groupsOf(key)[asked[1]!]!);
  await click("key-check-go");
}
async function mount(status: RecoveryStatus = { hasKey: false }, over: Partial<RecoveryApi> = {}) {
  resetCalls = 0;
  api = {
    status: vi.fn(async () => ok(status)),
    create: vi.fn(async () => ok({ key: KEY, devices: 1 })),
    rotate: vi.fn(async () => ok({ key: KEY2, pendingId: PENDING, expiresAt: EXPIRES })),
    confirmRotation: vi.fn(async () => ok(true as const)),
    cancelRotation: vi.fn(async () => ok(true as const)),
    redeem: vi.fn(async () => ok({ devices: 2 })),
    unlink: vi.fn(async () => ok(true as const)),
    remove: vi.fn(async () => ok(true as const)),
    ...over,
  };
  store = new RecoveryStore({
    api,
    sync: { ensureToken: async () => "tok", resetAfterLinkChange: async () => (resetCalls++, true) },
    writeClipboard: async () => {},
  });
  onBack = vi.fn();
  await act(async () => root.render(<SettingsScreen store={store} onBack={onBack as unknown as () => void} />));
  await flush();
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  setHighlightWrong(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  store?.reset();
  host.remove();
});

describe("SettingsScreen: состояния блока «Recovery key»", () => {
  it("1. нет ключа: «Create key» и «I already have a key», без рамки ошибок", async () => {
    await mount();
    expect(q("key-create")!.textContent).toBe("Create key");
    expect(q("key-have")!.textContent).toBe("I already have a key");
    expect(host.querySelector("h1")!.textContent).toBe("Settings");
    expect(q("key-error")).toBeNull();
  });

  it("2. ключ показан один раз: 8 плашек с озвучкой по знакам, копирование, предупреждение, «I’ve written it down» → проверка записи", async () => {
    await mount();
    await click("key-create");
    const chips = [...host.querySelectorAll(".settings-chip")];
    expect(chips).toHaveLength(8);
    expect(chips[0]!.textContent).toBe("K7QP");
    expect(chips[0]!.getAttribute("aria-label")).toBe("Group 1 of 8: K 7 Q P");
    expect(q("key-shown")!.getAttribute("aria-label")).toContain("8 groups");
    expect(document.activeElement).toBe(q("key-shown")); // фокус на ключе
    expect(host.querySelector(".settings-warn")).not.toBeNull();
    await click("key-copy");
    expect(q("key-copy")!.textContent).toBe("Copied");
    expect(q("key-copy")!.getAttribute("aria-live")).toBe("polite");
    await writeAndCheck(KEY);
    expect(q("key-shown")).toBeNull();
    expect(host.textContent).not.toContain("K7QP");
  });

  it("3. ключ создан: дата, число устройств, три действия; последнее — деструктивное", async () => {
    await mount({ hasKey: true, devices: 3, keyCreatedAt: "2026-09-30T10:00:00.000Z", pendingRotation: null });
    expect(q("key-created")!.textContent).toBe(formatCreated("2026-09-30T10:00:00.000Z", "en"));
    expect(q("key-devices")!.textContent).toBe("3");
    expect(q("key-reissue")).not.toBeNull();
    expect(q("key-unlink")).not.toBeNull();
    expect(q("key-delete")!.className).toContain("destructive");
  });

  it("4. ввод: живая нормализация, «Restore» неактивна до полного ключа, Enter отправляет", async () => {
    await mount();
    await click("key-have");
    expect(document.activeElement).toBe(q("key-field"));
    expect(q("key-restore")!.getAttribute("aria-disabled")).toBe("true");
    await type("k7qp m2xz");
    expect(q<HTMLTextAreaElement>("key-field")!.value).toBe("K7QP-M2XZ");
    await click("key-restore");
    expect(api.redeem).not.toHaveBeenCalled();
    await type(KEY.toLowerCase());
    expect(q("key-restore")!.getAttribute("aria-disabled")).toBe("false");
    await act(async () => void q("key-field")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await flush();
    expect(api.redeem).toHaveBeenCalledWith("tok", KEY.replace(/-/g, ""));
  });

  it("5–6. проверка и успех: спиннер и «Checking…», затем «Progress restored.»; синхронизация сброшена, поле пустое", async () => {
    let release!: (r: RecoveryResult<{ devices: number }>) => void;
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValueOnce(ok({ hasKey: false })).mockResolvedValue(ok({ hasKey: true, devices: 2, keyCreatedAt: null, pendingRotation: null }));
    await mount({ hasKey: false }, { status, redeem: () => new Promise((r) => (release = r)) });
    await click("key-have");
    await type(KEY);
    await click("key-restore");
    expect(q("key-restore")!.textContent).toBe("Checking…");
    expect(q("key-restore")!.getAttribute("aria-busy")).toBe("true");
    await act(async () => release(ok({ devices: 2 })));
    await flush();
    expect(resetCalls).toBe(1);
    expect(q("key-restored")!.textContent).toBe("Progress restored.");
    expect(q("key-restored")!.getAttribute("role")).toBe("status");
    expect(q("key-field")).toBeNull();
  });

  it("7. неверный ключ: alert, aria-invalid, кольцо; правка снимает ошибку", async () => {
    await mount({ hasKey: false }, { redeem: async () => ({ kind: "invalid_key" }) });
    await click("key-have");
    await type(KEY);
    await click("key-restore");
    expect(q("key-error")!.getAttribute("role")).toBe("alert");
    expect(q("key-error")!.textContent).toContain("didn’t work");
    expect(q("key-field")!.getAttribute("aria-invalid")).toBe("true");
    expect(q("key-field")!.getAttribute("aria-describedby")).toContain("settings-key-err");
    expect(host.querySelector(".settings-pad.bad")).not.toBeNull();
    await type(KEY.slice(0, -1));
    expect(q("key-error")).toBeNull();
  });

  it("8. лимит попыток: «in N min», «Restore» заблокирована", async () => {
    await mount({ hasKey: false }, { redeem: async () => ({ kind: "rate_limited", retryAfterSec: 600 }) });
    await click("key-have");
    await type(KEY);
    await click("key-restore");
    expect(q("key-error")!.textContent).toContain("in 10 min");
    expect(q("key-restore")!.getAttribute("aria-disabled")).toBe("true");
  });

  it("9. нет сети: сообщение и кнопка «Try again»", async () => {
    await mount({ hasKey: false }, { redeem: async () => ({ kind: "network" }) });
    await click("key-have");
    await type(KEY);
    await click("key-restore");
    expect(q("key-error")!.textContent).toContain("No connection");
    expect(q("key-restore")!.textContent).toBe("Try again");
    expect(q<HTMLTextAreaElement>("key-field")!.value).toBe(KEY);
  });

  it("статус не загрузился: сообщение и «Try again»", async () => {
    await mount({ hasKey: false }, { status: async () => ({ kind: "network" }) });
    expect(q("key-unavailable")).not.toBeNull();
    await click("key-status-retry");
  });

  it("PD-121d: при недоступном статусе «I already have a key» остаётся; ошибка — при «Restore», «Cancel» возвращает на карточку статуса", async () => {
    await mount(
      { hasKey: false },
      { status: async () => ({ kind: "network" }), redeem: async () => ({ kind: "network" }) },
    );
    expect(q("key-unavailable")).not.toBeNull();
    expect(q("key-have")).not.toBeNull();
    await click("key-have");
    await type(KEY);
    await click("key-restore");
    expect(q("key-error")!.textContent).toContain("No connection");
    await click("key-cancel");
    expect(q("key-unavailable")).not.toBeNull();
    expect(q("key-have")).not.toBeNull();
  });

  it("«Cancel» возвращает к «нет ключа» и стирает введённое", async () => {
    await mount();
    await click("key-have");
    await type(KEY);
    await click("key-cancel");
    expect(q("key-create")).not.toBeNull();
    expect(host.textContent).not.toContain("K7QP");
  });
});

describe("SettingsScreen: action sheets", () => {
  const created = { hasKey: true, devices: 2, keyCreatedAt: "2026-09-30T10:00:00.000Z", pendingRotation: null } as const;

  it("Replace key: диалог aria-modal, действие сверху, Esc закрывает, фокус возвращается на кнопку", async () => {
    await mount(created);
    q("key-reissue")!.focus();
    await click("key-reissue");
    const dlg = q("action-sheet")!;
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.textContent).toContain("Replace the recovery key?");
    // PD-88: текст не обещает отвязку других устройств (сервер при перевыпуске меняет только ключ)
    expect(dlg.textContent).toContain("stay connected");
    expect(dlg.textContent).not.toMatch(/is unlinked|will be unlinked/);
    // PD-126: замена больше ничего не ломает до подтверждения, шит не деструктивный
    expect(q("action-sheet-go")!.className).not.toContain("destructive");
    expect(q("action-sheet-go")!.textContent).toBe("Make new key");
    expect(dlg.textContent).toContain("keeps working until you check and confirm");
    await act(async () => void dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("action-sheet")).toBeNull();
    expect(document.activeElement).toBe(q("key-reissue"));
    expect(api.rotate).not.toHaveBeenCalled();
  });

  it("PD-121 (F9): в разрушающем шите (Delete) начальный фокус на «Cancel», в обычном (Replace после PD-126, Unlink) — на самом шите", async () => {
    await mount(created);
    await click("key-reissue");
    expect(document.activeElement).toBe(q("action-sheet")); // PD-126: замена не теряет старый ключ, шит не деструктивный
    await click("action-sheet-cancel");
    await click("key-delete");
    expect(document.activeElement).toBe(q("action-sheet-cancel"));
    await click("action-sheet-cancel");
    await click("key-unlink");
    expect(document.activeElement).toBe(q("action-sheet"));
  });

  it("Tab в диалоге не выходит за его пределы", async () => {
    await mount(created);
    await click("key-unlink");
    const go = q("action-sheet-go")!;
    const cancel = q("action-sheet-cancel")!;
    cancel.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => void cancel.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(go);
  });

  it("Tab, вышедший за шит (фокус на body), возвращается в шит; Esc на document закрывает шит и возвращает фокус", async () => {
    await mount(created);
    q("key-reissue")!.focus();
    await click("key-reissue");
    (document.activeElement as HTMLElement).blur(); // фокус на <body>, как после выхода Tab за пределы страницы
    expect(document.activeElement).toBe(document.body);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => void document.body.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(q("action-sheet-go"));
    (document.activeElement as HTMLElement).blur();
    const back = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    await act(async () => void document.body.dispatchEvent(back));
    expect(document.activeElement).toBe(q("action-sheet-cancel"));

    (document.activeElement as HTMLElement).blur();
    await act(async () => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("action-sheet")).toBeNull();
    expect(document.activeElement).toBe(q("key-reissue"));
  });

  it("пока шит открыт, фон inert (всё, кроме цепочки предков шита); после закрытия — снят", async () => {
    await mount(created);
    const reissue = q("key-reissue")!;
    reissue.focus();
    await click("key-reissue");
    const dlg = q("action-sheet-scrim")!;
    const inertNodes = () => [...document.body.querySelectorAll("[inert]")];
    expect(inertNodes().length).toBeGreaterThan(0);
    expect(inertNodes().some((n) => n.contains(reissue))).toBe(true); // кнопка-открыватель под inert
    expect(inertNodes().some((n) => n === dlg || n.contains(dlg))).toBe(false); // сам шит — нет
    await click("action-sheet-cancel");
    expect(inertNodes()).toHaveLength(0);
    expect(document.activeElement).toBe(reissue);
  });

  it("Unlink (не деструктивный): подтверждение → запрос → resetAfterLinkChange → «нет ключа»", async () => {
    await mount(created);
    await click("key-unlink");
    expect(q("action-sheet-go")!.className).not.toContain("destructive");
    await click("action-sheet-go");
    expect(api.unlink).toHaveBeenCalledWith("tok");
    expect(resetCalls).toBe(1);
    expect(q("key-create")).not.toBeNull();
  });

  it("Delete key: запрос и сброс", async () => {
    await mount(created);
    await click("key-delete");
    await click("action-sheet-go");
    expect(api.remove).toHaveBeenCalledWith("tok");
    expect(resetCalls).toBe(1);
  });

  it("уход с показанным ключом: шит «The key isn’t saved yet», «Stay» оставляет ключ", async () => {
    await mount();
    await click("key-create");
    const go = vi.fn();
    await act(async () => store.requestLeave(go));
    expect(q("action-sheet")!.textContent).toContain("isn’t saved yet");
    expect(q("action-sheet-cancel")!.textContent).toBe("Stay");
    await click("action-sheet-cancel");
    expect(go).not.toHaveBeenCalled();
    expect(q("key-shown")).not.toBeNull();
  });
});

describe("SettingsScreen: отложенная замена ключа (PD-126)", () => {
  const created = { hasKey: true, devices: 2, keyCreatedAt: "2026-09-30T10:00:00.000Z", pendingRotation: null } as const;
  const pending = { ...created, pendingRotation: { expiresAt: EXPIRES } } as const;

  async function startReplace() {
    await click("key-reissue");
    await click("action-sheet-go");
  }

  it("замена: экран «Your new key» с пояснением, что старый ключ работает; ничего не подтверждено само", async () => {
    await mount(created);
    await startReplace();
    expect(api.rotate).toHaveBeenCalledWith("tok");
    expect(host.querySelector("#settings-h-key")).not.toBeNull();
    expect(host.textContent).toContain("Your new key");
    expect(host.textContent).toContain("Your current key keeps working until you check and confirm it");
    expect([...host.querySelectorAll(".settings-chip")].map((c) => c.textContent).join("-")).toBe(KEY2);
    expect(document.activeElement).toBe(q("key-shown"));
    expect(api.confirmRotation).not.toHaveBeenCalled();
  });

  it("«Check and activate»: busy → confirm с pendingId → «New key is active», ключа на экране нет, pending-карточки нет", async () => {
    let release!: (r: RecoveryResult<true>) => void;
    await mount(created, { confirmRotation: vi.fn(() => new Promise<RecoveryResult<true>>((r) => (release = r))) });
    await startReplace();
    await writeAndCheck(KEY2);
    expect(q("key-check-go")!.getAttribute("aria-busy")).toBe("true");
    await act(async () => release(ok(true as const)));
    await flush();
    expect(api.confirmRotation).toHaveBeenCalledWith("tok", PENDING);
    expect(q("key-shown")).toBeNull();
    expect(host.textContent).not.toContain("ZQ8W");
    expect(q("key-replaced")!.textContent).toBe("New key is active. The old one no longer works.");
    expect(q("key-replaced")!.getAttribute("role")).toBe("status");
    expect(q("key-pending")).toBeNull();
  });

  it("ошибка сети при confirm: alert с понятным текстом, ключ остаётся, «Check and activate» можно нажать снова", async () => {
    const confirmRotation = vi.fn<RecoveryApi["confirmRotation"]>().mockResolvedValueOnce({ kind: "network" }).mockResolvedValue(ok(true as const));
    await mount(created, { confirmRotation });
    await startReplace();
    await writeAndCheck(KEY2);
    expect(q("key-error")!.getAttribute("role")).toBe("alert");
    expect(q("key-error")!.textContent).toContain("can’t tell yet whether the new key is already active");
    expect(q("key-error")!.textContent).toContain("repeating is safe");
    expect(q("key-check-0")).not.toBeNull(); // поля проверки остались заполненными, повтор — той же кнопкой
    await click("key-check-go");
    expect(q("key-shown")).toBeNull();
    expect(q("key-replaced")).not.toBeNull();
  });

  it("замена устарела (409): ключ стёрт, сказано, что рабочий ключ не менялся", async () => {
    await mount(created, { confirmRotation: async () => ({ kind: "stale_rotation" }) });
    await startReplace();
    await writeAndCheck(KEY2);
    expect(q("key-shown")).toBeNull();
    expect(q("key-error")!.getAttribute("data-kind")).toBe("stale");
    expect(q("key-error")!.textContent).toContain("no longer valid");
    expect(q("key-replaced")).toBeNull();
  });

  it("уход без подтверждения: шит про НОВЫЙ ключ, не деструктивный; «Leave» → pending-карточка со старым ключом рабочим", async () => {
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValueOnce(ok(created)).mockResolvedValue(ok(pending));
    await mount(created, { status });
    await startReplace();
    const go = vi.fn();
    await act(async () => store.requestLeave(go));
    expect(q("action-sheet")!.textContent).toContain("The new key isn’t confirmed yet");
    expect(q("action-sheet")!.textContent).toContain("current key keeps working");
    expect(q("action-sheet-go")!.className).not.toContain("destructive");
    await click("action-sheet-go");
    expect(go).toHaveBeenCalledTimes(1);
    expect(api.confirmRotation).not.toHaveBeenCalled();
    const card = q("key-pending")!;
    expect(card.textContent).toContain("New key not confirmed");
    expect(card.textContent).toContain("current key still works");
    expect(card.getAttribute("role")).toBe("group");
    expect(card.getAttribute("aria-labelledby")).toBe("settings-pending-title");
    expect(host.textContent).not.toContain("ZQ8W");
  });

  it("pending-карточка: «Start replacement again» открывает шит с текстом про отброшенный ключ; «Replace key» из списка скрыт", async () => {
    await mount(pending);
    expect(q("key-pending")).not.toBeNull();
    expect(host.querySelectorAll('[data-testid="key-reissue"]')).toHaveLength(1); // только в карточке
    await click("key-reissue");
    expect(q("action-sheet")!.textContent).toContain("wasn’t confirmed is discarded");
    await click("action-sheet-go");
    expect(api.rotate).toHaveBeenCalledTimes(1);
    expect(q("key-shown")).not.toBeNull();
  });

  it("«Cancel replacement»: запрос и карточка исчезает, строка «Replace key» возвращается", async () => {
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValueOnce(ok(pending)).mockResolvedValue(ok(created));
    await mount(pending, { status });
    await click("key-pending-cancel");
    expect(api.cancelRotation).toHaveBeenCalledWith("tok");
    expect(q("key-pending")).toBeNull();
    expect(q("key-reissue")).not.toBeNull();
  });

  it("тексты замены переводятся (uk, ru), карточка показывает срок", async () => {
    await mount(pending);
    await click("lang-uk");
    expect(q("key-pending")!.textContent).toContain("Новий ключ не підтверджено");
    await click("lang-ru");
    expect(q("key-pending")!.textContent).toContain("Новый ключ не подтверждён");
    expect(q("key-pending")!.textContent).not.toContain("{{");
  });
});

describe("SettingsScreen: язык и навигация", () => {
  it("«‹ Today» вызывает onBack; кнопка подписана", async () => {
    await mount();
    await click("settings-back");
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(q("settings-back")!.getAttribute("aria-label")).toBe("Back to Today");
  });

  it("язык: radiogroup, выбранный отмечен, клик переключает интерфейс и запоминает выбор; стрелки двигают выбор", async () => {
    await mount();
    expect(host.querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(q("lang-en")!.getAttribute("aria-checked")).toBe("true");
    expect(q("lang-en")!.tabIndex).toBe(0);
    expect(q("lang-ru")!.tabIndex).toBe(-1);
    await click("lang-uk");
    expect(i18n.resolvedLanguage).toBe("uk");
    expect(localStorage.getItem("pundoku.locale")).toBe("uk");
    expect(host.querySelector("h1")!.textContent).toBe("Налаштування");
    await act(async () => void q("lang-uk")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(i18n.resolvedLanguage).toBe("ru");
    expect(host.querySelector("h1")!.textContent).toBe("Настройки");
  });

  it("дата ключа форматируется без хвоста «г.»/«р.»", () => {
    expect(formatCreated("2026-09-30T10:00:00.000Z", "ru")).not.toMatch(/\sг\./);
    expect(formatCreated("2026-09-30T10:00:00.000Z", "uk")).not.toMatch(/\sр\./);
    expect(formatCreated(null, "en")).toBe("—");
  });

  it("дата ключа — как в макете PD-27: «30 Sep 2026» / «30 вер. 2026» / «30 сент. 2026»", () => {
    const iso = "2026-09-30T10:00:00.000Z";
    expect(formatCreated(iso, "en")).toBe("30 Sep 2026");
    expect(formatCreated(iso, "uk")).toBe("30 вер. 2026");
    expect(formatCreated(iso, "ru")).toBe("30 сент. 2026");
  });

  it("About (PD-102): последняя секция, знак 60 (малая оптика) + вордмарк 28, версия из package.json, всё декоративное", async () => {
    await mount();
    const sections = [...host.querySelectorAll("section.settings-sec")];
    const about = sections[sections.length - 1]!;
    expect(about.getAttribute("aria-labelledby")).toBe("settings-h-about");
    expect(about.querySelector("h2")!.textContent).toBe("About");
    const mark = about.querySelector<SVGSVGElement>("svg.settings-about-mark")!;
    expect(mark.getAttribute("width")).toBe("60");
    expect(mark.dataset.optics).toBe("small");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    const word = about.querySelector<SVGSVGElement>("svg.settings-about-word")!;
    expect(word.getAttribute("height")).toBe("28");
    expect(word.getAttribute("width")).toBe("142");
    expect(word.getAttribute("aria-hidden")).toBe("true");
    const { version } = pkg;
    expect(__APP_VERSION__).toBe(version);
    const ver = q("about-version")!;
    expect(ver.querySelector('[aria-hidden="true"]')!.textContent).toBe(`v${version}`);
    expect(ver.querySelector(".sr-only")!.textContent).toBe(`Pundoku, Version ${version}`);
    // не интерактивен: ни кнопок, ни ссылок внутри
    expect(about.querySelector(".settings-about")!.querySelector("button, a, [tabindex]")).toBeNull();
  });

  it("About: заголовок и озвучка версии переводятся (uk, ru)", async () => {
    await mount();
    await click("lang-uk");
    expect(host.querySelector("#settings-h-about")!.textContent).toBe("Про застосунок");
    expect(q("about-version")!.querySelector(".sr-only")!.textContent).toContain("Версія");
    await click("lang-ru");
    expect(host.querySelector("#settings-h-about")!.textContent).toBe("О приложении");
    expect(q("about-version")!.querySelector(".sr-only")!.textContent).toContain("Версия");
  });
});

describe("SettingsScreen: «Подсвечивать неверные цифры» (PD-112)", () => {
  const sw = () => q<HTMLInputElement>("highlight-wrong")!;

  it("секция «Game»: нативный switch, выкл по умолчанию, подпись-футер связана через aria-describedby", async () => {
    await mount();
    expect(host.querySelector("#settings-h-game")!.textContent).toBe("Game");
    expect(sw().tagName).toBe("INPUT");
    expect(sw().type).toBe("checkbox");
    expect(sw().getAttribute("role")).toBe("switch");
    expect(sw().checked).toBe(false);
    expect(sw().closest("label")!.textContent).toBe("Highlight wrong digits"); // доступное имя — текст строки
    const foot = host.querySelector("#" + sw().getAttribute("aria-describedby"))!;
    expect(foot.textContent).toContain("doesn’t match the solution");
    expect(foot.textContent).toContain("Off by default");
  });

  it("клик по строке (label) переключает и пишет в localStorage; повторный клик возвращает выкл и убирает ключ", async () => {
    await mount();
    const label = sw().closest("label")!;
    await act(async () => label.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(sw().checked).toBe(true);
    expect(localStorage.getItem(HIGHLIGHT_WRONG_KEY)).toBe("1");
    expect(getHighlightWrong()).toBe(true);
    await act(async () => label.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(sw().checked).toBe(false);
    expect(localStorage.getItem(HIGHLIGHT_WRONG_KEY)).toBeNull();
  });

  it("профиль со старым состоянием (язык сохранён, ключа настройки нет) — switch выкл; сохранённое «1» — вкл", async () => {
    localStorage.setItem("pundoku.locale", "en");
    await mount();
    expect(sw().checked).toBe(false);
    act(() => root.unmount());
    root = createRoot(host);
    setHighlightWrong(true);
    await mount();
    expect(sw().checked).toBe(true);
  });

  it("подписи переводятся (uk, ru)", async () => {
    await mount();
    await click("lang-uk");
    expect(host.querySelector("#settings-h-game")!.textContent).toBe("Гра");
    expect(sw().closest("label")!.textContent).toBe("Підсвічувати неправильні цифри");
    await click("lang-ru");
    expect(host.querySelector("#settings-h-game")!.textContent).toBe("Игра");
    expect(sw().closest("label")!.textContent).toBe("Подсвечивать неверные цифры");
  });
});

describe("SettingsScreen: проверка записи ключа (PD-142)", () => {
  const created = { hasKey: true, devices: 2, keyCreatedAt: "2026-09-30T10:00:00.000Z", pendingRotation: null } as const;
  const keyOf = (i: number, key = KEY) => key.split("-")[askedGroups()[i]!]!;
  const fillRight = async (key = KEY) => {
    await typeCheck(0, keyOf(0, key));
    await typeCheck(1, keyOf(1, key));
  };
  const pressKey = async (el: Element, key: string) => {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    await act(async () => void el.dispatchEvent(ev));
    await flush();
    return ev;
  };
  const toCheck = async () => {
    await mount();
    await click("key-create");
    await click("key-saved");
  };

  it("«I’ve written it down» вместо «Key saved»: сначала проверка, ключ с экрана уходит, фокус в первом поле", async () => {
    await mount();
    await click("key-create");
    expect(q("key-saved")!.textContent).toBe("I’ve written it down");
    expect(q("key-check-0")).toBeNull();
    await click("key-saved");
    expect(q("key-shown")).toBeNull();
    expect(host.querySelectorAll(".settings-chip")).toHaveLength(0);
    for (const g of KEY.split("-")) expect(host.textContent).not.toContain(g); // ключ не светится рядом с полями
    expect(document.activeElement).toBe(q("key-check-0"));
    expect(api.confirmRotation).not.toHaveBeenCalled();
  });

  it("поля: две разные группы по возрастанию; label с номером группы; атрибуты ввода без автоисправления, iOS-зума и подсказок", async () => {
    await toCheck();
    const [a, b] = askedGroups();
    expect(a).toBeLessThan(b!);
    const inputs = checkInputs();
    inputs.forEach((el, i) => {
      const label = host.querySelector(`label[for="${el.id}"]`)!;
      expect(label.textContent).toBe(`Group ${askedGroups()[i]! + 1} of 8`);
      expect(el.type).toBe("text");
      expect(el.getAttribute("autocapitalize")).toBe("characters");
      expect(el.getAttribute("autocorrect")).toBe("off");
      expect(el.getAttribute("autocomplete")).toBe("off");
      expect(el.getAttribute("spellcheck")).toBe("false");
      expect(el.getAttribute("enterkeyhint")).toBe(i === 0 ? "next" : "done");
      expect(el.getAttribute("aria-describedby")).toBe("settings-check-hint");
      expect(el.hasAttribute("aria-invalid")).toBe(false);
    });
    expect(host.querySelector('[role="group"][aria-labelledby="settings-check-cap"]')).not.toBeNull();
    expect(host.querySelector("#settings-check-intro")!.textContent).toContain("enter two of its groups");
  });

  it("«Check» неактивна, пока обе группы не набраны целиком; ввод нормализуется на лету", async () => {
    await toCheck();
    const go = () => q("key-check-go")!;
    expect(go().getAttribute("aria-disabled")).toBe("true");
    await typeCheck(0, ` ${keyOf(0).toLowerCase().slice(0, 2)}-${keyOf(0).toLowerCase().slice(2)} `);
    expect(checkInputs()[0]!.value).toBe(keyOf(0));
    expect(go().getAttribute("aria-disabled")).toBe("true");
    await click("key-check-go"); // неактивна — тап ничего не делает
    expect(q("key-error")).toBeNull();
    await typeCheck(1, keyOf(1));
    expect(go().getAttribute("aria-disabled")).toBe("false");
  });

  it("неверный ввод: мягкий alert, помечено только неверное поле (aria-invalid), ключа нет, шаг не закрыт; правка снимает ошибку", async () => {
    await toCheck();
    await typeCheck(0, keyOf(0));
    await typeCheck(1, keyOf(1) === "AAAA" ? "BBBB" : "AAAA");
    await click("key-check-go");
    const err = q("key-error")!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.getAttribute("data-kind")).toBe("mismatch");
    expect(err.textContent).toContain("That doesn’t match");
    expect(checkInputs().map((el) => el.getAttribute("aria-invalid"))).toEqual([null, "true"]);
    expect(checkInputs().every((el) => el.getAttribute("aria-describedby")!.includes("settings-check-err"))).toBe(true);
    expect(host.querySelector("#settings-check-err")).toBe(err);
    expect(q("key-created")).toBeNull();
    await typeCheck(1, keyOf(1));
    expect(q("key-error")).toBeNull();
    expect(checkInputs()[1]!.hasAttribute("aria-invalid")).toBe(false);
    await click("key-check-go");
    expect(q("key-created")).not.toBeNull();
    expect(host.textContent).not.toContain("K7QP");
  });

  it("«Show the key again»: плашки на месте, фокус на ключе, введённое стёрто; в проверку можно вернуться и пройти", async () => {
    await toCheck();
    await typeCheck(0, "ZZZZ");
    await click("key-check-back");
    expect(q("key-check-0")).toBeNull();
    expect([...host.querySelectorAll(".settings-chip")].map((c) => c.textContent).join("-")).toBe(KEY);
    expect(document.activeElement).toBe(q("key-shown"));
    await click("key-saved");
    expect(checkInputs().map((el) => el.value)).toEqual(["", ""]);
    await fillRight();
    await click("key-check-go");
    expect(q("key-created")).not.toBeNull();
  });

  it("Enter: в первом поле — к следующему, в последнем — «Check» (при неверном — ошибка, не отправка)", async () => {
    await toCheck();
    await fillRight();
    checkInputs()[0]!.focus();
    const ev = await pressKey(checkInputs()[0]!, "Enter");
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(checkInputs()[1]);
    expect(q("key-created")).toBeNull();
    await pressKey(checkInputs()[1]!, "Enter");
    expect(q("key-created")).not.toBeNull();
  });

  it("пропуск есть, но с честным предупреждением: строка под кнопкой, шит с фокусом на «Check the key»; «Stay» не пропускает", async () => {
    await toCheck();
    expect(host.textContent).toContain("without a written-down key progress can’t be restored on another device");
    await click("key-check-skip");
    const sheet = q("action-sheet")!;
    expect(sheet.textContent).toContain("Skip the check?");
    expect(sheet.textContent).toContain("can’t be restored on another device");
    expect(sheet.textContent).toContain("this key can’t be shown again");
    expect(document.activeElement).toBe(q("action-sheet-cancel"));
    expect(q("action-sheet-cancel")!.textContent).toBe("Check the key");
    await click("action-sheet-cancel");
    expect(q("action-sheet")).toBeNull();
    expect(q("key-check-0")).not.toBeNull();
    await click("key-check-skip");
    await click("action-sheet-go");
    expect(q("key-created")).not.toBeNull();
    expect(host.textContent).not.toContain("K7QP");
  });

  it("замена, пропуск: шит предупреждает, что старый ключ перестанет работать; confirm уходит только после «Skip the check»", async () => {
    await mount(created);
    await click("key-reissue");
    await click("action-sheet-go");
    await click("key-saved");
    expect(q("key-check-go")!.textContent).toBe("Check and activate");
    expect(api.confirmRotation).not.toHaveBeenCalled();
    await click("key-check-skip");
    expect(q("action-sheet")!.textContent).toContain("the old one will stop working");
    expect(api.confirmRotation).not.toHaveBeenCalled();
    await click("action-sheet-go");
    expect(api.confirmRotation).toHaveBeenCalledWith("tok", PENDING);
    expect(q("key-replaced")).not.toBeNull();
  });

  it("замена: неверный ввод не трогает сервер (старый ключ жив), верный — confirm один раз", async () => {
    await mount(created);
    await click("key-reissue");
    await click("action-sheet-go");
    await click("key-saved");
    await typeCheck(0, "AAAA");
    await typeCheck(1, "BBBB");
    await click("key-check-go");
    expect(api.confirmRotation).not.toHaveBeenCalled();
    expect(checkInputs().map((el) => el.getAttribute("aria-invalid"))).toEqual(["true", "true"]);
    await fillRight(KEY2);
    await click("key-check-go");
    expect(api.confirmRotation).toHaveBeenCalledTimes(1);
  });

  it("uk и ru: подписи полей, кнопки и предупреждение пропуска переведены", async () => {
    await toCheck();
    await click("key-check-back");
    await click("lang-uk");
    await click("key-saved");
    expect(host.querySelector(`label[for="settings-check-0"]`)!.textContent).toMatch(/^Група \d з 8$/);
    expect(q("key-check-go")!.textContent).toBe("Перевірити");
    expect(host.textContent).toContain("не відновити на іншому пристрої");
    await click("key-check-back");
    await click("lang-ru");
    await click("key-saved");
    expect(host.querySelector(`label[for="settings-check-0"]`)!.textContent).toMatch(/^Группа \d из 8$/);
    expect(q("key-check-go")!.textContent).toBe("Проверить");
    expect(host.textContent).toContain("не восстановить на другом устройстве");
  });
});
