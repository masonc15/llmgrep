// src/spawn.test.ts
import { describe, test, expect } from "bun:test";
import { spawnWithTimeout, pipeProcesses } from "./spawn";

describe("spawnWithTimeout", () => {
  test("completes fast command successfully", async () => {
    const result = await spawnWithTimeout({
      cmd: ["echo", "hello"],
      timeout: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
  });

  test("times out slow command", async () => {
    const result = await spawnWithTimeout({
      cmd: ["sleep", "10"],
      timeout: 100,
    });
    expect(result.timedOut).toBe(true);
  });

  test("captures stderr", async () => {
    const result = await spawnWithTimeout({
      cmd: ["bash", "-c", "echo error >&2"],
      timeout: 5000,
    });
    expect(result.stderr).toContain("error");
  });
});

describe("pipeProcesses", () => {
  test("pipes stdout to stdin correctly", async () => {
    const result = await pipeProcesses({
      source: { cmd: ["echo", "hello world"] },
      sink: { cmd: ["grep", "hello"] },
      timeout: 5000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
  });

  test("handles source failure", async () => {
    const result = await pipeProcesses({
      source: { cmd: ["bash", "-c", "exit 1"] },
      sink: { cmd: ["cat"] },
      timeout: 5000,
    });
    expect(result.sourceExitCode).toBe(1);
  });

  test("times out long-running pipe", async () => {
    const result = await pipeProcesses({
      source: { cmd: ["sleep", "10"] },
      sink: { cmd: ["cat"] },
      timeout: 100,
    });
    expect(result.timedOut).toBe(true);
  });
});
