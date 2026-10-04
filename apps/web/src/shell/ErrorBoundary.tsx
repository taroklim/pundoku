import type { ErrorInfo, ReactNode } from "react";
import { Component, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Mark } from "../brand/Mark";

/**
 * Тихий экран сбоя (PD-146): исключение при рендере не должно оставлять белый экран. Данные не трогаем — прогресс живёт в
 * IndexedDB и от падения интерфейса не зависит; ничего не отправляем в сеть, только `console.error`. Баг не маскируется:
 * ошибка залогирована, а «Reload» перезапускает приложение с нуля.
 * Ловит только ошибки рендера/жизненного цикла (не обработчики событий и не промисы — это ограничение React).
 */
export function CrashScreen({ scope }: { scope: "app" | "tab" }) {
  const { t } = useTranslation();
  const reload = useRef<HTMLButtonElement>(null);
  // Экран сбоя — role=alert: фокус сразу на единственное действие (клавиатура/VoiceOver не ищут кнопку), без прокрутки
  // и сдвига вёрстки (`preventScroll`; рамка фокуса — outline, место не занимает).
  useEffect(() => {
    reload.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className={`crash crash-${scope}`} role="alert" data-testid="crash-screen">
      <Mark size={56} className="crash-mark" />
      <h1 className="crash-title">{t("crash.title")}</h1>
      <p>{t("crash.body")}</p>
      <button ref={reload} type="button" className="cta" onClick={() => window.location.reload()}>
        {t("crash.reload")}
      </button>
    </div>
  );
}

interface Props {
  children: ReactNode;
  /** `app` — вокруг всего приложения (на весь экран); `tab` — вокруг содержимого вкладки (таб-бар остаётся рабочим). */
  scope: "app" | "tab";
  /**
   * PD-161: панели вкладок больше не размонтируются при смене вкладки — экран сбоя сбрасывается явно, когда с вкладки ушли
   * (`active` true → false): вернувшись, пользователь получает свежую попытку отрисовать вкладку, как раньше при новом маунте.
   */
  active?: boolean;
}

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[pundoku] ошибка рендера (${this.props.scope}):`, error, info.componentStack);
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.active === true && this.props.active === false && this.state.failed) this.setState({ failed: false });
  }

  override render(): ReactNode {
    return this.state.failed ? <CrashScreen scope={this.props.scope} /> : this.props.children;
  }
}
