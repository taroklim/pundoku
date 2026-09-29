import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDirectRun } from "./migrate.js";

describe("isDirectRun — запуск через симлинк не должен молча выходить", () => {
  let dir: string;
  let real: string;
  let link: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pundoku-migrate-"));
    real = path.join(dir, "migrate.js");
    link = path.join(dir, "link-to-migrate.js");
    await writeFile(real, "");
    await symlink(real, link);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("тот же файл по прямому пути → true", async () => {
    expect(await isDirectRun(real, pathToFileURL(real).href)).toBe(true);
  });

  it("argv[1] — симлинк на модуль → true (раньше сравнение URL давало false)", async () => {
    expect(await isDirectRun(link, pathToFileURL(real).href)).toBe(true);
  });

  it("другой файл → false; argv[1] не задан → false", async () => {
    const other = path.join(dir, "other.js");
    await writeFile(other, "");
    expect(await isDirectRun(other, pathToFileURL(real).href)).toBe(false);
    expect(await isDirectRun(undefined, pathToFileURL(real).href)).toBe(false);
  });

  it("argv[1] не существует → false, без исключения", async () => {
    expect(await isDirectRun(path.join(dir, "missing.js"), pathToFileURL(real).href)).toBe(false);
  });
});
