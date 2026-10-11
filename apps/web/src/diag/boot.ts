/**
 * PD-295, #/diag: ПЕРВЫЙ импорт main.tsx — выполняется до кода приложения (модули вычисляются в порядке импорта).
 * Адрес `#/diag` включает флаг и уводит на Year; при включённом флаге ставит счётчики событий и аудит слушателей до того, как
 * React и экраны повесят свои. Без флага — ничего (ни обёрток, ни слушателей).
 */
import { installListenerAudit, installProbes } from "./audit";
import { consumeDiagHash, diagEnabled } from "./flag";

consumeDiagHash();
if (diagEnabled()) {
  installProbes();
  installListenerAudit();
}
