/** Боевая сборка PD-27 web: HTTP-клиент + менеджер синхронизации приложения. Побочных эффектов при импорте нет. */
import { sync } from "../sync/runtime";
import { httpRecoveryApi } from "./api";
import { RecoveryStore } from "./store";

export const recoveryStore = new RecoveryStore({ api: httpRecoveryApi(), sync: sync.manager });
