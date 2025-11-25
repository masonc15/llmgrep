// src/cleanup.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { TempFileManager, ProcessManager } from "./cleanup";

describe("TempFileManager", () => {
  let manager: TempFileManager;

  beforeEach(() => {
    manager = new TempFileManager();
  });

  afterEach(async () => {
    await manager.cleanupAll();
  });

  test("creates temp file with prefix", async () => {
    const path = await manager.create("test-prefix");
    expect(path).toContain("test-prefix");
    expect(path).toContain(tmpdir());

    const file = Bun.file(path);
    expect(await file.exists()).toBe(true);
  });

  test("tracks created files", async () => {
    await manager.create("file1");
    await manager.create("file2");
    expect(manager.getTrackedFiles().length).toBe(2);
  });

  test("cleans up single file", async () => {
    const path = await manager.create("cleanup-test");
    expect(await Bun.file(path).exists()).toBe(true);

    await manager.cleanup(path);
    expect(await Bun.file(path).exists()).toBe(false);
    expect(manager.getTrackedFiles()).not.toContain(path);
  });

  test("cleans up all files", async () => {
    const path1 = await manager.create("cleanup1");
    const path2 = await manager.create("cleanup2");

    await manager.cleanupAll();

    expect(await Bun.file(path1).exists()).toBe(false);
    expect(await Bun.file(path2).exists()).toBe(false);
    expect(manager.getTrackedFiles().length).toBe(0);
  });
});

describe("ProcessManager", () => {
  let manager: ProcessManager;

  beforeEach(() => {
    manager = new ProcessManager();
  });

  afterEach(() => {
    manager.killAll();
  });

  test("tracks spawned processes", () => {
    const proc = Bun.spawn(["sleep", "10"]);
    manager.track(proc);
    expect(manager.getTrackedProcesses().length).toBe(1);
  });

  test("kills tracked process", () => {
    const proc = Bun.spawn(["sleep", "10"]);
    manager.track(proc);
    manager.kill(proc);
    expect(manager.getTrackedProcesses().length).toBe(0);
  });

  test("kills all processes", () => {
    const proc1 = Bun.spawn(["sleep", "10"]);
    const proc2 = Bun.spawn(["sleep", "10"]);
    manager.track(proc1);
    manager.track(proc2);

    manager.killAll();

    expect(manager.getTrackedProcesses().length).toBe(0);
  });
});
