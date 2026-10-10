/**
 * PD-267: подписи клавиш на чипах десктопа C (макет pd229 §2 «Клавиши видны»: Notes `N`, Undo `⌘Z`, Erase `⌫`, Hint `H`).
 * На Mac — `⌘`/`⇧`, на Windows/Linux — `Ctrl`/`Shift` (там `⌘` нет). Сами сочетания уже работают (`handleGameKey`, PD-232):
 * здесь только то, что написано на чипе, и значение `aria-keyshortcuts`.
 */
export interface DeskKeys {
  readonly notes: string;
  readonly undo: string;
  /** `aria-keyshortcuts` для Undo: обе формы, как принимает `handleGameKey` (⌘Z и Ctrl+Z). */
  readonly undoAria: string;
  readonly erase: string;
  readonly hint: string;
  readonly fill: string;
  readonly shift: string;
}

/** Платформа Apple (macOS, iPadOS в альбомной раскладке): по `navigator.platform`, запасной путь — user agent. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(p);
}

export function deskKeys(apple = isApplePlatform()): DeskKeys {
  return {
    notes: "N",
    undo: apple ? "⌘Z" : "Ctrl+Z",
    undoAria: "Meta+Z Control+Z",
    erase: "⌫",
    hint: "H",
    fill: "F",
    shift: apple ? "⇧" : "Shift",
  };
}
