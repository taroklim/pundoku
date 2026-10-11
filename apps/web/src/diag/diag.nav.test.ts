/**
 * PD-295: маршрут #/diag скрыт — его нет в исходниках навигации (таб-бар, сайдбар, список маршрутов), в манифесте PWA,
 * index.html и карте сайта/robots (если появятся в public/).
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
  readFileSync(u: URL, enc: "utf8"): string;
  readdirSync(u: URL): string[];
};

describe("PD-295: diag не в навигации", () => {
  it("исходники навигации, манифест, index.html и карта сайта не упоминают diag", () => {
    const src = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8").toLowerCase();
    for (const f of ["../shell/TabBar.tsx", "../shell/Sidebar.tsx", "../shell/tabs.ts", "../../pwa.config.ts", "../../index.html"]) expect(src(f), f).not.toContain("diag");
    const pub = new URL("../../public/", import.meta.url);
    for (const f of fs.readdirSync(pub).filter((x) => /sitemap|robots|manifest/i.test(x))) expect(src(new URL(f, pub).href), f).not.toContain("diag");
  });
});
