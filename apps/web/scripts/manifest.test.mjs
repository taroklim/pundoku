// PD-132: манифест PWA — только портрет. Источник правды — pwa.config.ts (его читает vite.config.ts → vite-plugin-pwa).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { webManifest } from "../pwa.config.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("манифест PWA (PD-132)", () => {
  it("orientation: portrait — ландшафт запрещён (решение владельца)", () => {
    expect(webManifest.orientation).toBe("portrait");
  });

  it("standalone, scope и start_url — корень, имя Pundoku", () => {
    expect(webManifest).toMatchObject({ name: "Pundoku", display: "standalone", start_url: "/", scope: "/" });
  });

  it("vite.config.ts берёт манифест из pwa.config.ts, а не держит свою копию (иначе тест проверял бы не то)", () => {
    const cfg = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(cfg).toMatch(/manifest:\s*webManifest/);
    expect(cfg).not.toMatch(/orientation\s*:/);
  });
});
