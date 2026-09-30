// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { RecoveryApi, RecoveryResult, RecoveryStatus } from "./api";
import { formatCreated, SettingsScreen } from "./SettingsScreen";
import { RecoveryStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "K7QP-M2XZ-9D4T-VB6N-H3RW-8YCJ-5FGA-E0S1";
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
async function mount(status: RecoveryStatus = { hasKey: false }, over: Partial<RecoveryApi> = {}) {
  resetCalls = 0;
  api = {
    status: vi.fn(async () => ok(status)),
    create: vi.fn(async () => ok({ key: KEY, devices: 1 })),
    rotate: vi.fn(async () => ok({ key: KEY })),
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

  it("2. ключ показан один раз: 8 плашек с озвучкой по знакам, копирование, предупреждение, «Key saved»", async () => {
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
    await click("key-saved");
    expect(q("key-shown")).toBeNull();
    expect(host.textContent).not.toContain("K7QP");
  });

  it("3. ключ создан: дата, число устройств, три действия; последнее — деструктивное", async () => {
    await mount({ hasKey: true, devices: 3, keyCreatedAt: "2026-09-30T10:00:00.000Z" });
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
    const status = vi.fn<RecoveryApi["status"]>().mockResolvedValueOnce(ok({ hasKey: false })).mockResolvedValue(ok({ hasKey: true, devices: 2, keyCreatedAt: null }));
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
  const created = { hasKey: true, devices: 2, keyCreatedAt: "2026-09-30T10:00:00.000Z" } as const;

  it("Replace key: диалог aria-modal, действие сверху, Esc закрывает, фокус возвращается на кнопку", async () => {
    await mount(created);
    q("key-reissue")!.focus();
    await click("key-reissue");
    const dlg = q("action-sheet")!;
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.textContent).toContain("Replace the recovery key?");
    expect(q("action-sheet-go")!.className).toContain("destructive");
    await act(async () => void dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("action-sheet")).toBeNull();
    expect(document.activeElement).toBe(q("key-reissue"));
    expect(api.rotate).not.toHaveBeenCalled();
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
});
