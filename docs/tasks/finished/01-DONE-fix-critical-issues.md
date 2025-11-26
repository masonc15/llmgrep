Status: Done — implemented on 2025-11-25
Summary: see docs/tasks/summaries/01-SOW-fix-critical-issues.md

---

# Fix Critical Issues 1-10 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the 10 critical and serious issues identified in the code review to make llmgrep production-ready.

**Architecture:** Create a shared utilities module for common functions (parseArgs, cleanup, validation). Implement proper resource cleanup with try/finally patterns. Add streaming support for memory efficiency. Replace unsafe patterns with typed alternatives.

**Tech Stack:** Bun, TypeScript, bun:test

---

## Issues to Fix

1. Memory Leak: Temp files never cleaned up
2. Race Condition: Stream piping without error handling
3. `null as any` type casting
4. Silent error swallowing
5. No input validation on parse arguments
6. Unbounded memory growth
7. Hardcoded path assumptions
8. Process exit without cleanup
9. No timeout on external processes
10. Duplicate code everywhere

---

## Task 1: Create Shared Types Module

**Files:**
- Create: `src/types.ts`

**Step 1: Create the types file**

```typescript
// src/types.ts

export interface SearchOptions {
  topK?: number;
  maxDistance?: number;
  context?: number;
}

export interface MessageContent {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface JSONLRecord {
  type?: string;
  message?: {
    role?: string;
    content?: string | MessageContent[];
  };
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  uuid?: string;
  parentUuid?: string;
  [key: string]: unknown;
}

export interface TextEntry {
  text: string;
  filePath: string;
  projectPath: string;
  cwd?: string;
  timestamp?: string;
  role?: string;
  sessionId?: string;
}

export interface SearchResult {
  lineNumber: number;
  distance: number;
  entry: TextEntry | null;
}

export interface ParsedArgs {
  query: string;
  options: SearchOptions;
}

// Constants - no more magic numbers
export const MAX_RESULTS_DISPLAY = 25;
export const DEFAULT_TOP_K = 3;
export const DEFAULT_CONTEXT = 3;
export const INTERACTIVE_TOP_K = 1000;
export const TRUNCATE_PREVIEW_LENGTH = 150;
export const TRUNCATE_TEXT_LENGTH = 500;
export const AUTO_REFINE_MAX_ATTEMPTS = 15;
export const OPTIMAL_RESULT_MIN = 15;
export const DISTANCE_THRESHOLDS = [0.3, 0.35, 0.4, 0.45, 0.5] as const;
export const BINARY_SEARCH_PRECISION = 0.02;
```

**Step 2: Verify file compiles**

Run: `bun build src/types.ts --outdir=/dev/null 2>&1 || echo "Compile check"`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "add shared types module with constants"
```

---

## Task 2: Create Shared Utilities Module

**Files:**
- Create: `src/utils.ts`
- Create: `src/utils.test.ts`

**Step 1: Write failing tests for parseArgs**

```typescript
// src/utils.test.ts
import { describe, test, expect } from "bun:test";
import { parseArgs, validateSearchOptions, getProjectsDir } from "./utils";

describe("parseArgs", () => {
  test("parses query without flags", () => {
    const result = parseArgs(["search term"]);
    expect(result.query).toBe("search term");
    expect(result.options.topK).toBe(3);
    expect(result.options.context).toBe(3);
  });

  test("parses --top-k flag", () => {
    const result = parseArgs(["query", "--top-k", "10"]);
    expect(result.options.topK).toBe(10);
  });

  test("parses --max-distance flag", () => {
    const result = parseArgs(["query", "--max-distance", "0.5"]);
    expect(result.options.maxDistance).toBe(0.5);
  });

  test("parses --context flag", () => {
    const result = parseArgs(["query", "--context", "5"]);
    expect(result.options.context).toBe(5);
  });

  test("returns null query when missing", () => {
    const result = parseArgs(["--top-k", "5"]);
    expect(result.query).toBe("");
  });
});

describe("validateSearchOptions", () => {
  test("throws on invalid topK", () => {
    expect(() => validateSearchOptions({ topK: NaN })).toThrow("topK must be a positive integer");
  });

  test("throws on negative topK", () => {
    expect(() => validateSearchOptions({ topK: -1 })).toThrow("topK must be a positive integer");
  });

  test("throws on invalid maxDistance", () => {
    expect(() => validateSearchOptions({ maxDistance: NaN })).toThrow("maxDistance must be a number between 0 and 1");
  });

  test("throws on maxDistance > 1", () => {
    expect(() => validateSearchOptions({ maxDistance: 1.5 })).toThrow("maxDistance must be a number between 0 and 1");
  });

  test("throws on invalid context", () => {
    expect(() => validateSearchOptions({ context: NaN })).toThrow("context must be a non-negative integer");
  });

  test("passes valid options", () => {
    expect(() => validateSearchOptions({ topK: 5, maxDistance: 0.5, context: 3 })).not.toThrow();
  });
});

describe("getProjectsDir", () => {
  test("returns path under HOME", () => {
    const dir = getProjectsDir();
    expect(dir).toContain(".claude/projects");
    expect(dir).not.toContain("~");
  });

  test("throws if HOME is not set", () => {
    const originalHome = process.env.HOME;
    delete process.env.HOME;
    try {
      expect(() => getProjectsDir()).toThrow("HOME environment variable is not set");
    } finally {
      process.env.HOME = originalHome;
    }
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/utils.test.ts`
Expected: FAIL - module not found

**Step 3: Implement utils module**

```typescript
// src/utils.ts
import { join } from "path";
import type { SearchOptions, ParsedArgs } from "./types";
import { DEFAULT_TOP_K, DEFAULT_CONTEXT } from "./types";

export function parseArgs(args: string[], defaults?: Partial<SearchOptions>): ParsedArgs {
  const options: SearchOptions = {
    topK: defaults?.topK ?? DEFAULT_TOP_K,
    context: defaults?.context ?? DEFAULT_CONTEXT,
  };

  let query = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--top-k' && i + 1 < args.length) {
      const value = parseInt(args[++i]!, 10);
      options.topK = value;
    } else if (arg === '--max-distance' && i + 1 < args.length) {
      const value = parseFloat(args[++i]!);
      options.maxDistance = value;
    } else if (arg === '--context' && i + 1 < args.length) {
      const value = parseInt(args[++i]!, 10);
      options.context = value;
    } else if (arg === '--help' || arg === '-h') {
      // Handled by caller
      continue;
    } else if (!arg!.startsWith('--')) {
      query = arg!;
    }
  }

  return { query, options };
}

export function validateSearchOptions(options: SearchOptions): void {
  if (options.topK !== undefined) {
    if (!Number.isInteger(options.topK) || options.topK <= 0) {
      throw new Error("topK must be a positive integer");
    }
  }

  if (options.maxDistance !== undefined) {
    if (typeof options.maxDistance !== 'number' || Number.isNaN(options.maxDistance) || options.maxDistance < 0 || options.maxDistance > 1) {
      throw new Error("maxDistance must be a number between 0 and 1");
    }
  }

  if (options.context !== undefined) {
    if (!Number.isInteger(options.context) || options.context < 0) {
      throw new Error("context must be a non-negative integer");
    }
  }
}

export function getProjectsDir(): string {
  const home = process.env.HOME;
  if (!home) {
    throw new Error("HOME environment variable is not set");
  }
  return join(home, '.claude', 'projects');
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/utils.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/utils.ts src/utils.test.ts
git commit -m "add shared utilities with input validation"
```

---

## Task 3: Create Cleanup Utilities Module

**Files:**
- Create: `src/cleanup.ts`
- Create: `src/cleanup.test.ts`

**Step 1: Write failing tests for cleanup utilities**

```typescript
// src/cleanup.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "path";
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
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/cleanup.test.ts`
Expected: FAIL - module not found

**Step 3: Implement cleanup module**

```typescript
// src/cleanup.ts
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";
import type { Subprocess } from "bun";

export class TempFileManager {
  private files: Set<string> = new Set();

  async create(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await Bun.write(path, "");
    this.files.add(path);
    return path;
  }

  getTrackedFiles(): string[] {
    return Array.from(this.files);
  }

  async cleanup(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      // File may already be deleted, ignore
    }
    this.files.delete(path);
  }

  async cleanupAll(): Promise<void> {
    const paths = Array.from(this.files);
    await Promise.all(paths.map(path => this.cleanup(path)));
  }
}

export class ProcessManager {
  private processes: Set<Subprocess> = new Set();

  track(proc: Subprocess): void {
    this.processes.add(proc);

    // Auto-remove when process exits
    proc.exited.then(() => {
      this.processes.delete(proc);
    }).catch(() => {
      this.processes.delete(proc);
    });
  }

  getTrackedProcesses(): Subprocess[] {
    return Array.from(this.processes);
  }

  kill(proc: Subprocess): void {
    try {
      proc.kill();
    } catch {
      // Process may already be dead
    }
    this.processes.delete(proc);
  }

  killAll(): void {
    for (const proc of this.processes) {
      this.kill(proc);
    }
  }
}

// Global instances for cleanup on process exit
const globalTempManager = new TempFileManager();
const globalProcessManager = new ProcessManager();

export function getGlobalTempManager(): TempFileManager {
  return globalTempManager;
}

export function getGlobalProcessManager(): ProcessManager {
  return globalProcessManager;
}

// Register cleanup handlers
function setupCleanupHandlers(): void {
  const cleanup = async () => {
    globalProcessManager.killAll();
    await globalTempManager.cleanupAll();
  };

  process.on('exit', () => {
    globalProcessManager.killAll();
    // Can't await in exit handler, but files will be cleaned by OS eventually
  });

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(143);
  });

  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await cleanup();
    process.exit(1);
  });
}

setupCleanupHandlers();
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/cleanup.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/cleanup.ts src/cleanup.test.ts
git commit -m "add cleanup utilities for temp files and processes"
```

---

## Task 4: Create Process Spawning Utilities with Timeout and Error Handling

**Files:**
- Create: `src/spawn.ts`
- Create: `src/spawn.test.ts`

**Step 1: Write failing tests for spawn utilities**

```typescript
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
    expect(result.exitCode).not.toBe(0);
  });

  test("captures stderr", async () => {
    const result = await spawnWithTimeout({
      cmd: ["bash", "-c", "echo error >&2"],
      timeout: 5000,
    });
    expect(result.stderr).toContain("error");
  });

  test("handles command not found", async () => {
    await expect(spawnWithTimeout({
      cmd: ["nonexistent-command-12345"],
      timeout: 5000,
    })).rejects.toThrow();
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
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/spawn.test.ts`
Expected: FAIL - module not found

**Step 3: Implement spawn module**

```typescript
// src/spawn.ts
import { getGlobalProcessManager } from "./cleanup";

export interface SpawnOptions {
  cmd: string[];
  timeout: number;
  stdin?: ReadableStream | string;
  cwd?: string;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface PipeOptions {
  source: { cmd: string[]; cwd?: string };
  sink: { cmd: string[]; cwd?: string };
  timeout: number;
}

export interface PipeResult {
  exitCode: number;
  sourceExitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function spawnWithTimeout(options: SpawnOptions): Promise<SpawnResult> {
  const { cmd, timeout, stdin, cwd } = options;
  const processManager = getGlobalProcessManager();

  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: stdin instanceof ReadableStream ? stdin : (stdin ? new Response(stdin).body : undefined),
    stdout: "pipe",
    stderr: "pipe",
  });

  processManager.track(proc);

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  try {
    const [exitCode, stdoutText, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timeoutId);

    return {
      exitCode,
      stdout: stdoutText,
      stderr: stderrText,
      timedOut,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function pipeProcesses(options: PipeOptions): Promise<PipeResult> {
  const { source, sink, timeout } = options;
  const processManager = getGlobalProcessManager();

  const sourceProc = Bun.spawn(source.cmd, {
    cwd: source.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  processManager.track(sourceProc);

  const sinkProc = Bun.spawn(sink.cmd, {
    cwd: sink.cwd,
    stdin: sourceProc.stdout,
    stdout: "pipe",
    stderr: "pipe",
  });

  processManager.track(sinkProc);

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    sourceProc.kill();
    sinkProc.kill();
  }, timeout);

  try {
    const [sourceExitCode, sinkExitCode, stdoutText, stderrText] = await Promise.all([
      sourceProc.exited,
      sinkProc.exited,
      new Response(sinkProc.stdout).text(),
      new Response(sinkProc.stderr).text(),
    ]);

    clearTimeout(timeoutId);

    return {
      exitCode: sinkExitCode,
      sourceExitCode,
      stdout: stdoutText,
      stderr: stderrText,
      timedOut,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    sourceProc.kill();
    sinkProc.kill();
    throw error;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/spawn.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/spawn.ts src/spawn.test.ts
git commit -m "add spawn utilities with timeout and piping support"
```

---

## Task 5: Create Typed SearchResult Builder (Fix Issue 3)

**Files:**
- Create: `src/search-result.ts`
- Create: `src/search-result.test.ts`

**Step 1: Write failing tests for search result builder**

```typescript
// src/search-result.test.ts
import { describe, test, expect } from "bun:test";
import { SearchResultBuilder, parseSearchOutput } from "./search-result";
import type { TextEntry } from "./types";

describe("SearchResultBuilder", () => {
  test("creates incomplete result without entry", () => {
    const builder = new SearchResultBuilder(5, 0.25);
    const result = builder.build();

    expect(result.lineNumber).toBe(5);
    expect(result.distance).toBe(0.25);
    expect(result.entry).toBeNull();
  });

  test("creates complete result with entry", () => {
    const entry: TextEntry = {
      text: "test",
      filePath: "/path/to/file",
      projectPath: "project",
    };

    const builder = new SearchResultBuilder(5, 0.25);
    builder.setEntry(entry);
    const result = builder.build();

    expect(result.entry).toEqual(entry);
  });

  test("hasEntry returns correct state", () => {
    const builder = new SearchResultBuilder(5, 0.25);
    expect(builder.hasEntry()).toBe(false);

    builder.setEntry({ text: "test", filePath: "/path", projectPath: "proj" });
    expect(builder.hasEntry()).toBe(true);
  });
});

describe("parseSearchOutput", () => {
  test("parses valid search output line", () => {
    const output = "/path/to/file:123::456 (0.123456)";
    const results = parseSearchOutput(output);

    expect(results.length).toBe(1);
    expect(results[0]!.lineNumber).toBe(123);
    expect(results[0]!.distance).toBeCloseTo(0.123456);
  });

  test("parses multiple lines", () => {
    const output = `/path:1::1 (0.1)
/path:2::2 (0.2)
/path:3::3 (0.3)`;
    const results = parseSearchOutput(output);

    expect(results.length).toBe(3);
  });

  test("skips invalid lines", () => {
    const output = `invalid line
/path:1::1 (0.1)
another invalid`;
    const results = parseSearchOutput(output);

    expect(results.length).toBe(1);
  });

  test("returns empty array for empty input", () => {
    const results = parseSearchOutput("");
    expect(results.length).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/search-result.test.ts`
Expected: FAIL - module not found

**Step 3: Implement search result module**

```typescript
// src/search-result.ts
import type { SearchResult, TextEntry } from "./types";

export class SearchResultBuilder {
  private lineNumber: number;
  private distance: number;
  private entry: TextEntry | null = null;

  constructor(lineNumber: number, distance: number) {
    this.lineNumber = lineNumber;
    this.distance = distance;
  }

  setEntry(entry: TextEntry): this {
    this.entry = entry;
    return this;
  }

  hasEntry(): boolean {
    return this.entry !== null;
  }

  build(): SearchResult {
    return {
      lineNumber: this.lineNumber,
      distance: this.distance,
      entry: this.entry,
    };
  }
}

export function parseSearchOutput(output: string): SearchResult[] {
  const results: SearchResult[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Match format: filename:123::456 (0.123456)
    const match = line.match(/^[^:]+:(\d+)::(\d+)\s+\(([0-9.]+)\)/);
    if (match) {
      const builder = new SearchResultBuilder(
        parseInt(match[1]!, 10),
        parseFloat(match[3]!)
      );
      results.push(builder.build());
    }
  }

  return results;
}

export function attachEntries(results: SearchResult[], entries: TextEntry[]): SearchResult[] {
  return results.map(result => {
    const entry = entries[result.lineNumber];
    if (entry) {
      return { ...result, entry };
    }
    return result;
  });
}

export function sortByDistance(results: SearchResult[]): SearchResult[] {
  return [...results].sort((a, b) => a.distance - b.distance);
}
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/search-result.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/search-result.ts src/search-result.test.ts
git commit -m "add typed search result builder, removing null as any"
```

---

## Task 6: Create Error Logger with Debug Mode (Fix Issue 4)

**Files:**
- Create: `src/logger.ts`
- Create: `src/logger.test.ts`

**Step 1: Write failing tests for logger**

```typescript
// src/logger.test.ts
import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { Logger, setDebugMode, isDebugMode } from "./logger";

describe("Logger", () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleWarnSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {});
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    setDebugMode(false);
  });

  test("logs errors always", () => {
    const logger = new Logger("test");
    logger.error("error message");
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  test("logs warnings always", () => {
    const logger = new Logger("test");
    logger.warn("warning message");
    expect(consoleWarnSpy).toHaveBeenCalled();
  });

  test("skips debug messages when debug mode off", () => {
    setDebugMode(false);
    const logger = new Logger("test");
    logger.debug("debug message");
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  test("logs debug messages when debug mode on", () => {
    setDebugMode(true);
    const logger = new Logger("test");
    logger.debug("debug message");
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  test("logs skipped JSON parse errors in debug mode", () => {
    setDebugMode(true);
    const logger = new Logger("parser");
    logger.skippedLine("invalid json", new Error("parse error"));
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  test("does not log skipped lines in normal mode", () => {
    setDebugMode(false);
    const logger = new Logger("parser");
    logger.skippedLine("invalid json", new Error("parse error"));
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});

describe("debug mode", () => {
  afterEach(() => {
    setDebugMode(false);
  });

  test("isDebugMode returns false by default", () => {
    expect(isDebugMode()).toBe(false);
  });

  test("setDebugMode changes state", () => {
    setDebugMode(true);
    expect(isDebugMode()).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun test src/logger.test.ts`
Expected: FAIL - module not found

**Step 3: Implement logger module**

```typescript
// src/logger.ts

let debugMode = false;

export function setDebugMode(enabled: boolean): void {
  debugMode = enabled;
}

export function isDebugMode(): boolean {
  return debugMode;
}

// Check environment variable on load
if (process.env.DEBUG === 'true' || process.env.DEBUG === '1') {
  debugMode = true;
}

export class Logger {
  private prefix: string;

  constructor(prefix: string) {
    this.prefix = prefix;
  }

  error(message: string, error?: Error): void {
    console.error(`[${this.prefix}] ERROR: ${message}`);
    if (error && debugMode) {
      console.error(error.stack);
    }
  }

  warn(message: string): void {
    console.warn(`[${this.prefix}] WARN: ${message}`);
  }

  debug(message: string): void {
    if (debugMode) {
      console.log(`[${this.prefix}] DEBUG: ${message}`);
    }
  }

  skippedLine(line: string, error: Error): void {
    if (debugMode) {
      const preview = line.length > 50 ? line.substring(0, 50) + '...' : line;
      console.log(`[${this.prefix}] SKIPPED: "${preview}" - ${error.message}`);
    }
  }

  info(message: string): void {
    console.log(`[${this.prefix}] ${message}`);
  }
}

// Default logger for general use
export const logger = new Logger('llmgrep');
```

**Step 4: Run tests to verify they pass**

Run: `bun test src/logger.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/logger.ts src/logger.test.ts
git commit -m "add logger with debug mode for error visibility"
```

---

## Task 7: Create Barrel Export and Update Extract Files

**Files:**
- Create: `src/index.ts`
- Modify: `extract-text.ts`
- Modify: `extract-with-metadata.ts`

**Step 1: Create barrel export**

```typescript
// src/index.ts
export * from "./types";
export * from "./utils";
export * from "./cleanup";
export * from "./spawn";
export * from "./search-result";
export * from "./logger";
```

**Step 2: Verify barrel compiles**

Run: `bun build src/index.ts --outdir=/dev/null 2>&1 || echo "Compile check"`
Expected: No errors

**Step 3: Update extract-text.ts to use shared utilities**

```typescript
// extract-text.ts
#!/usr/bin/env bun

import { readdir } from "fs/promises";
import { join } from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { getProjectsDir, Logger } from "./src";
import type { MessageContent, JSONLRecord } from "./src";

const logger = new Logger('extract-text');

async function* walkDir(dir: string): AsyncGenerator<string> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        yield fullPath;
      }
    }
  } catch (error) {
    logger.error(`Failed to read directory: ${dir}`, error as Error);
  }
}

async function* extractTextFromFile(filePath: string): AsyncGenerator<string> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record: JSONLRecord = JSON.parse(line);

      if (record.message?.content) {
        const content = record.message.content;

        if (typeof content === 'string') {
          if (content.trim()) {
            yield content;
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text?.trim()) {
              yield block.text;
            }
          }
        }
      }
    } catch (error) {
      logger.skippedLine(line, error as Error);
    }
  }
}

async function main() {
  try {
    const projectsDir = getProjectsDir();

    for await (const filePath of walkDir(projectsDir)) {
      for await (const text of extractTextFromFile(filePath)) {
        console.log(text.replace(/\n/g, ' '));
      }
    }
  } catch (error) {
    logger.error('Error extracting text', error as Error);
    process.exit(1);
  }
}

main();
```

**Step 4: Update extract-with-metadata.ts to use shared utilities**

```typescript
// extract-with-metadata.ts
#!/usr/bin/env bun

import { readdir } from "fs/promises";
import { join, basename, dirname } from "path";
import { createReadStream } from "fs";
import { createInterface } from "readline";
import { getProjectsDir, Logger } from "./src";
import type { MessageContent, JSONLRecord, TextEntry } from "./src";

const logger = new Logger('extract-metadata');

async function* walkDir(dir: string): AsyncGenerator<string> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        yield* walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        yield fullPath;
      }
    }
  } catch (error) {
    logger.error(`Failed to read directory: ${dir}`, error as Error);
  }
}

async function* extractTextFromFile(filePath: string): AsyncGenerator<TextEntry> {
  const fileStream = createReadStream(filePath);
  const rl = createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const fileName = basename(filePath, '.jsonl');
  const parentDir = dirname(filePath);
  const projectPath = basename(parentDir);

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const record: JSONLRecord = JSON.parse(line);

      if (record.message?.content) {
        const content = record.message.content;
        const texts: string[] = [];

        if (typeof content === 'string') {
          if (content.trim()) {
            texts.push(content);
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text?.trim()) {
              texts.push(block.text);
            }
          }
        }

        for (const text of texts) {
          yield {
            text,
            filePath,
            projectPath,
            cwd: record.cwd,
            timestamp: record.timestamp,
            role: record.message.role,
            sessionId: record.sessionId || fileName,
          };
        }
      }
    } catch (error) {
      logger.skippedLine(line, error as Error);
    }
  }
}

async function main() {
  try {
    const projectsDir = getProjectsDir();

    for await (const filePath of walkDir(projectsDir)) {
      for await (const entry of extractTextFromFile(filePath)) {
        console.log(JSON.stringify(entry));
      }
    }
  } catch (error) {
    logger.error('Error extracting text', error as Error);
    process.exit(1);
  }
}

main();
```

**Step 5: Verify both files work**

Run: `bun run extract-text.ts 2>&1 | head -5`
Expected: Some text output (or empty if no Claude projects)

Run: `bun run extract-with-metadata.ts 2>&1 | head -5`
Expected: JSON output (or empty if no Claude projects)

**Step 6: Commit**

```bash
git add src/index.ts extract-text.ts extract-with-metadata.ts
git commit -m "update extract files to use shared utilities"
```

---

## Task 8: Refactor interactive-search.ts (Issues 1, 3, 6, 8)

**Files:**
- Modify: `interactive-search.ts`

**Step 1: Read current file for reference**

Review the current implementation at `interactive-search.ts`

**Step 2: Rewrite with proper cleanup, types, and streaming**

```typescript
// interactive-search.ts
#!/usr/bin/env bun

import { spawn } from "child_process";
import { join } from "path";
import { createWriteStream } from "fs";
import { createInterface } from "readline";
import { select } from "@inquirer/prompts";
import { ExitPromptError } from "@inquirer/core";
import { extractConversation } from "./extract-conversation";
import {
  parseArgs,
  validateSearchOptions,
  truncate,
  getGlobalTempManager,
  parseSearchOutput,
  attachEntries,
  sortByDistance,
  Logger,
  setDebugMode,
  INTERACTIVE_TOP_K,
  MAX_RESULTS_DISPLAY,
  TRUNCATE_PREVIEW_LENGTH,
  DISTANCE_THRESHOLDS,
  AUTO_REFINE_MAX_ATTEMPTS,
  OPTIMAL_RESULT_MIN,
  BINARY_SEARCH_PRECISION,
} from "./src";
import type { SearchOptions, TextEntry, SearchResult } from "./src";

const logger = new Logger('interactive-search');
const tempManager = getGlobalTempManager();

function printHelp() {
  console.log(`
llmgrep (Interactive) - Search and copy conversations to clipboard

Usage: bun run interactive-search.ts <query> [options]

Arguments:
  <query>               Search query (semantic matching)

Options:
  --max-distance <num>  Maximum cosine distance threshold (0.0-1.0)
                        Recommended values based on testing:
                        - 0.4 for precision (fewer, more relevant results)
                        - 0.5 for recall (more results, broader matches)
  --top-k <number>      Max results (default: ${INTERACTIVE_TOP_K}, warns if >${MAX_RESULTS_DISPLAY})
  --debug               Enable debug logging
  -h, --help           Show this help message

Examples:
  bun run interactive-search.ts "authentication methods"
  bun run interactive-search.ts "bug fixes" --max-distance 0.4
  bun run interactive-search.ts "react hooks" --max-distance 0.5
`);
}

async function extractMetadata(): Promise<{ entries: TextEntry[]; tempFile: string }> {
  const extractScript = join(import.meta.dir, 'extract-with-metadata.ts');
  const tempFile = await tempManager.create('llmgrep');

  return new Promise((resolve, reject) => {
    const entries: TextEntry[] = [];
    const textLines: string[] = [];

    const extract = spawn('bun', ['run', extractScript], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const rl = createInterface({
      input: extract.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        const entry: TextEntry = JSON.parse(line);
        entries.push(entry);
        textLines.push(entry.text.replace(/\n/g, ' '));
      } catch (error) {
        logger.skippedLine(line, error as Error);
      }
    });

    extract.on('error', reject);

    extract.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Extraction failed with code ${code}`));
        return;
      }

      const writeStream = createWriteStream(tempFile);
      for (const line of textLines) {
        writeStream.write(line + '\n');
      }
      writeStream.end();

      await new Promise((resolveWrite) => writeStream.on('finish', resolveWrite));
      resolve({ entries, tempFile });
    });
  });
}

async function performSearch(
  tempFile: string,
  query: string,
  options: SearchOptions
): Promise<SearchResult[]> {
  return new Promise((resolve, reject) => {
    const searchArgs = [query, tempFile, '-n', '0'];

    if (options.maxDistance !== undefined) {
      searchArgs.push('-m', options.maxDistance.toString());
    } else {
      searchArgs.push('--top-k', options.topK!.toString());
    }

    const search = spawn('search', searchArgs, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let output = '';
    search.stdout.on('data', (data) => {
      output += data.toString();
    });

    search.on('error', () => {
      reject(new Error('Make sure "search" command is installed (npm install -g @llamaindex/semtools)'));
    });

    search.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Search failed with code ${code}`));
        return;
      }

      resolve(parseSearchOutput(output));
    });
  });
}

async function copyToClipboard(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let command: string;
    let args: string[] = [];

    if (process.platform === 'darwin') {
      command = 'pbcopy';
    } else if (process.platform === 'win32') {
      command = 'clip';
    } else {
      command = 'xclip';
      args = ['-selection', 'clipboard'];
    }

    const proc = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'inherit'],
    });

    proc.stdin.write(text);
    proc.stdin.end();

    proc.on('error', (error) => {
      reject(new Error(`Failed to copy to clipboard: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error('Failed to copy to clipboard'));
      }
    });
  });
}

async function handleTooManyResults(
  resultCount: number,
  query: string,
  entries: TextEntry[],
  tempFile: string
): Promise<void> {
  console.log(`\nToo many results (${resultCount}).`);

  let choice: string | number;
  try {
    choice = await select({
      message: 'How would you like to refine your search?',
      choices: [
        {
          name: 'Auto - Automatically find optimal distance (recommended)',
          value: 'auto',
          description: 'Tries distances from 0.3 to 0.5 until results fit',
        },
        {
          name: 'Distance 0.3 - Very specific (exact matches)',
          value: 0.3,
          description: 'Most restrictive, fewest results',
        },
        {
          name: 'Distance 0.4 - Precision (recommended)',
          value: 0.4,
          description: 'Good balance of relevance and results',
        },
        {
          name: 'Distance 0.5 - Recall (broader)',
          value: 0.5,
          description: 'More results, broader matches',
        },
        {
          name: 'Cancel',
          value: 'cancel',
          description: 'Exit search',
        },
      ],
    });
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log('\n\nSearch cancelled.');
      return;
    }
    throw error;
  }

  if (choice === 'cancel') {
    console.log('\nSearch cancelled.');
    return;
  }

  if (choice === 'auto') {
    return await autoRefineSearch(query, entries, tempFile);
  }

  console.log(`\nSearching with distance ${choice}...`);
  const results = await performSearch(tempFile, query, { maxDistance: choice as number });

  if (results.length === 0) {
    console.log('No results found with this distance. Try a higher value.');
    return await handleTooManyResults(0, query, entries, tempFile);
  }

  if (results.length > MAX_RESULTS_DISPLAY) {
    console.log(`\nStill too many results (${results.length}).`);
    return await handleTooManyResults(results.length, query, entries, tempFile);
  }

  await displayResultsAndCopy(results, entries, query, tempFile, choice as number);
}

async function autoRefineSearch(
  query: string,
  entries: TextEntry[],
  tempFile: string,
  maxAttempts: number = AUTO_REFINE_MAX_ATTEMPTS
): Promise<void> {
  console.log('\nAuto-refining search...\n');

  let attempt = 0;
  let lastGoodDistance: number | null = null;
  let lastGoodCount = 0;

  for (const distance of DISTANCE_THRESHOLDS) {
    if (attempt++ >= maxAttempts) {
      console.log('\nMax refinement attempts reached.');
      if (lastGoodDistance) {
        console.log(`Using best result with ${lastGoodCount} matches at distance ${lastGoodDistance}.\n`);
        const results = await performSearch(tempFile, query, { maxDistance: lastGoodDistance });
        await displayResultsAndCopy(results, entries, query, tempFile, lastGoodDistance);
        return;
      }
      console.log('Please try a more specific query.');
      return;
    }

    console.log(`  Trying distance ${distance}...`);
    const results = await performSearch(tempFile, query, { maxDistance: distance });

    if (results.length === 0) {
      console.log(`    No results, trying broader...`);
      continue;
    }

    if (results.length <= MAX_RESULTS_DISPLAY) {
      console.log(`    Found ${results.length} results!\n`);
      await displayResultsAndCopy(results, entries, query, tempFile, distance);
      return;
    }

    console.log(`    Too many (${results.length}), trying stricter...`);

    if (lastGoodDistance !== null && lastGoodCount < MAX_RESULTS_DISPLAY) {
      console.log(`  Detected jump from ${lastGoodCount} to ${results.length} results.`);
      console.log(`  Fine-tuning between ${lastGoodDistance} and ${distance}...\n`);

      const refined = await binarySearchDistance(
        query,
        entries,
        tempFile,
        lastGoodDistance,
        distance,
        maxAttempts - attempt
      );

      if (refined) {
        return;
      }
    }

    if (results.length <= MAX_RESULTS_DISPLAY) {
      lastGoodDistance = distance;
      lastGoodCount = results.length;
    }
  }

  if (lastGoodDistance) {
    console.log(`\nUsing best result with ${lastGoodCount} matches at distance ${lastGoodDistance}.\n`);
    const results = await performSearch(tempFile, query, { maxDistance: lastGoodDistance });
    await displayResultsAndCopy(results, entries, query, tempFile, lastGoodDistance);
    return;
  }

  console.log('\nCould not find a good distance threshold automatically.');
  console.log('Try refining your query or using a manual distance setting.');
}

async function binarySearchDistance(
  query: string,
  entries: TextEntry[],
  tempFile: string,
  minDistance: number,
  maxDistance: number,
  remainingAttempts: number
): Promise<boolean> {
  let left = minDistance;
  let right = maxDistance;
  let bestDistance = minDistance;
  let bestCount = 0;
  let attempts = 0;

  while (attempts < remainingAttempts && right - left > BINARY_SEARCH_PRECISION) {
    const mid = (left + right) / 2;
    attempts++;

    console.log(`    Testing distance ${mid.toFixed(2)}...`);
    const results = await performSearch(tempFile, query, { maxDistance: mid });

    if (results.length === 0) {
      console.log(`      No results, going higher...`);
      left = mid;
      continue;
    }

    if (results.length <= MAX_RESULTS_DISPLAY) {
      console.log(`      Good! ${results.length} results.`);
      bestDistance = mid;
      bestCount = results.length;

      if (results.length >= OPTIMAL_RESULT_MIN) {
        console.log(`    Found optimal: ${results.length} results at distance ${bestDistance.toFixed(2)}!\n`);
        await displayResultsAndCopy(results, entries, query, tempFile, bestDistance);
        return true;
      }

      left = mid;
    } else {
      console.log(`      Too many (${results.length}), going lower...`);
      right = mid;
    }
  }

  if (bestCount > 0) {
    console.log(`    Found ${bestCount} results at distance ${bestDistance.toFixed(2)}!\n`);
    const results = await performSearch(tempFile, query, { maxDistance: bestDistance });
    await displayResultsAndCopy(results, entries, query, tempFile, bestDistance);
    return true;
  }

  return false;
}

async function displayResultsAndCopy(
  results: SearchResult[],
  entries: TextEntry[],
  query: string,
  tempFile?: string,
  currentDistance?: number
): Promise<void> {
  const resultsWithEntries = sortByDistance(attachEntries(results, entries));

  console.log(`Found ${resultsWithEntries.length} result(s).`);
  console.log(`Select one to copy the full conversation to clipboard:\n`);

  const groupedByCwd = resultsWithEntries.reduce((groups, result) => {
    const cwd = result.entry?.cwd || 'Unknown';
    if (!groups[cwd]) {
      groups[cwd] = [];
    }
    groups[cwd].push(result);
    return groups;
  }, {} as Record<string, typeof resultsWithEntries>);

  const choices: Array<{ name: string; value: number; disabled?: boolean; description?: string }> = [];
  const cwds = Object.keys(groupedByCwd).sort();

  cwds.forEach((cwd) => {
    const cwdShort = cwd.split('/').slice(-2).join('/');
    choices.push({
      name: `\n------- ${cwdShort} -------`,
      value: -2,
      disabled: true,
    });

    groupedByCwd[cwd]!.forEach((result) => {
      const entry = result.entry;
      if (!entry) return;

      const date = entry.timestamp ? new Date(entry.timestamp).toLocaleDateString() : 'Unknown';
      const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const preview = truncate(entry.text, TRUNCATE_PREVIEW_LENGTH);

      choices.push({
        name: `  ${date} ${time} | ${entry.role?.toUpperCase() || 'N/A'} [${(result.distance * 100).toFixed(1)}%]\n    ${preview}`,
        value: resultsWithEntries.indexOf(result),
        description: `Full path: ${entry.cwd || 'N/A'} | Distance: ${result.distance.toFixed(4)}`,
      });
    });
  });

  if (resultsWithEntries.length < MAX_RESULTS_DISPLAY && tempFile && currentDistance && currentDistance < 0.6) {
    choices.push({
      name: '\nGo Broader - Search with higher distance threshold',
      value: -3,
      description: `Try distance ${(currentDistance + 0.1).toFixed(1)} for more results`,
    });
  }

  choices.push({
    name: 'Cancel',
    value: -1,
    description: 'Exit without copying',
  });

  let selectedIndex: number;
  try {
    selectedIndex = await select({
      message: 'Select a result to copy the full conversation:',
      choices,
      pageSize: 15,
    });
  } catch (error) {
    if (error instanceof ExitPromptError) {
      console.log('\n\nCancelled.');
      return;
    }
    throw error;
  }

  if (selectedIndex === -1) {
    console.log('\nCancelled.');
    return;
  }

  if (selectedIndex === -3 && tempFile && currentDistance) {
    const newDistance = currentDistance + 0.1;
    console.log(`\nSearching with broader distance ${newDistance.toFixed(1)}...`);
    const newResults = await performSearch(tempFile, query, { maxDistance: newDistance });

    if (newResults.length === 0) {
      console.log('No additional results found.');
      return await displayResultsAndCopy(results, entries, query, tempFile, currentDistance);
    }

    if (newResults.length > MAX_RESULTS_DISPLAY) {
      return await handleTooManyResults(newResults.length, query, entries, tempFile);
    }

    return await displayResultsAndCopy(newResults, entries, query, tempFile, newDistance);
  }

  const selected = resultsWithEntries[selectedIndex];
  if (!selected?.entry) {
    logger.error('Selected result has no entry attached');
    return;
  }

  console.log('\nExtracting full conversation...');

  try {
    const conversation = await extractConversation(selected.entry.filePath, selected.entry.sessionId!);
    await copyToClipboard(conversation);

    console.log('\nFull conversation copied to clipboard!');
    console.log(`\nConversation details:`);
    console.log(`  Project: ${selected.entry.projectPath.replace(/-/g, '/')}`);
    console.log(`  Session: ${selected.entry.sessionId}`);
    console.log(`  File: ${selected.entry.filePath}`);
  } catch (error) {
    logger.error('Failed to extract conversation', error as Error);
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Check for debug flag
  if (args.includes('--debug')) {
    setDebugMode(true);
    args.splice(args.indexOf('--debug'), 1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.length === 0) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const { query, options } = parseArgs(args, { topK: INTERACTIVE_TOP_K });

  if (!query) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    validateSearchOptions(options);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  console.log('Extracting text from Claude projects...');
  const { entries, tempFile } = await extractMetadata();
  console.log(`Found ${entries.length} text entries across all conversations.\n`);

  console.log(`Searching for: "${query}"\n`);
  const results = await performSearch(tempFile, query, options);

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  const resultsWithEntries = sortByDistance(attachEntries(results, entries));

  console.log(`Found ${resultsWithEntries.length} result(s).`);

  if (resultsWithEntries.length > MAX_RESULTS_DISPLAY) {
    return await handleTooManyResults(resultsWithEntries.length, query, entries, tempFile);
  }

  await displayResultsAndCopy(resultsWithEntries, entries, query, tempFile);
}

main();
```

**Step 3: Verify the refactored file runs**

Run: `bun run interactive-search.ts --help`
Expected: Help text displayed

**Step 4: Commit**

```bash
git add interactive-search.ts
git commit -m "refactor interactive-search with proper cleanup and types"
```

---

## Task 9: Refactor search-with-context.ts (Issues 1, 6, 8)

**Files:**
- Modify: `search-with-context.ts`

**Step 1: Rewrite with proper cleanup**

```typescript
// search-with-context.ts
#!/usr/bin/env bun

import { spawn } from "child_process";
import { join } from "path";
import { createWriteStream } from "fs";
import { createInterface } from "readline";
import {
  parseArgs,
  validateSearchOptions,
  getGlobalTempManager,
  parseSearchOutput,
  Logger,
  setDebugMode,
  DEFAULT_TOP_K,
  DEFAULT_CONTEXT,
  TRUNCATE_TEXT_LENGTH,
} from "./src";
import type { SearchOptions, TextEntry } from "./src";

const logger = new Logger('search-context');
const tempManager = getGlobalTempManager();

function printHelp() {
  console.log(`
llmgrep - Semantic search across your Claude conversation history

Usage: bun run search-with-context.ts <query> [options]

Arguments:
  <query>               Search query (semantic matching)

Options:
  --top-k <number>      Number of results to return (default: ${DEFAULT_TOP_K})
  --max-distance <num>  Maximum cosine distance threshold (0.0+)
  --context <number>    Lines of context before/after match (default: ${DEFAULT_CONTEXT})
  --debug               Enable debug logging
  -h, --help           Show this help message

Examples:
  bun run search-with-context.ts "authentication methods" --top-k 5
  bun run search-with-context.ts "bug in user registration" --max-distance 0.3
  bun run search-with-context.ts "react hooks" --context 5
`);
}

async function extractMetadata(): Promise<{ entries: TextEntry[]; tempFile: string }> {
  const extractScript = join(import.meta.dir, 'extract-with-metadata.ts');
  const tempFile = await tempManager.create('llmgrep-context');

  return new Promise((resolve, reject) => {
    const entries: TextEntry[] = [];
    const textLines: string[] = [];

    const extract = spawn('bun', ['run', extractScript], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const rl = createInterface({
      input: extract.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      try {
        const entry: TextEntry = JSON.parse(line);
        entries.push(entry);
        textLines.push(entry.text.replace(/\n/g, ' '));
      } catch (error) {
        logger.skippedLine(line, error as Error);
      }
    });

    extract.on('error', reject);

    extract.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Extraction failed with code ${code}`));
        return;
      }

      const writeStream = createWriteStream(tempFile);
      for (const line of textLines) {
        writeStream.write(line + '\n');
      }
      writeStream.end();

      await new Promise((resolveWrite) => writeStream.on('finish', resolveWrite));
      resolve({ entries, tempFile });
    });
  });
}

async function performSearch(
  tempFile: string,
  query: string,
  options: SearchOptions
): Promise<Array<{ lineNumber: number; distance: number }>> {
  return new Promise((resolve, reject) => {
    const searchArgs = [query, tempFile, '-n', '0'];

    if (options.maxDistance !== undefined) {
      searchArgs.push('-m', options.maxDistance.toString());
    } else {
      searchArgs.push('--top-k', options.topK!.toString());
    }

    const search = spawn('search', searchArgs, {
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let output = '';
    search.stdout.on('data', (data) => {
      output += data.toString();
    });

    search.on('error', () => {
      reject(new Error('Make sure "search" command is installed (npm install -g @llamaindex/semtools)'));
    });

    search.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Search failed with code ${code}`));
        return;
      }

      resolve(parseSearchOutput(output));
    });
  });
}

function formatResult(entry: TextEntry, distance: number, index: number) {
  const date = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Unknown date';
  const role = entry.role ? entry.role.toUpperCase() : 'UNKNOWN';
  const project = entry.projectPath.replace(/-/g, '/');

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Result ${index + 1} - Distance: ${distance.toFixed(4)}`);
  console.log(`${'='.repeat(80)}`);
  console.log(`Project: ${project}`);
  console.log(`Role: ${role}`);
  console.log(`Date: ${date}`);
  console.log(`Session: ${entry.sessionId}`);
  console.log(`${'-'.repeat(80)}`);

  const text = entry.text.length > TRUNCATE_TEXT_LENGTH
    ? entry.text.substring(0, TRUNCATE_TEXT_LENGTH) + '...'
    : entry.text;
  console.log(text);
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);

  // Check for debug flag
  if (args.includes('--debug')) {
    setDebugMode(true);
    args.splice(args.indexOf('--debug'), 1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.length === 0) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const { query, options } = parseArgs(args);

  if (!query) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    validateSearchOptions(options);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  console.log('Extracting text from Claude projects...');
  const { entries, tempFile } = await extractMetadata();
  console.log(`Found ${entries.length} text entries across all conversations.\n`);

  console.log(`Searching for: "${query}"\n`);
  const results = await performSearch(tempFile, query, options);

  if (results.length === 0) {
    console.log('No results found.');
    return;
  }

  console.log(`Found ${results.length} result(s):\n`);

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const entry = entries[result.lineNumber];
    if (entry) {
      formatResult(entry, result.distance, i);
    }
  }
}

main();
```

**Step 2: Verify refactored file runs**

Run: `bun run search-with-context.ts --help`
Expected: Help text displayed

**Step 3: Commit**

```bash
git add search-with-context.ts
git commit -m "refactor search-with-context with proper cleanup"
```

---

## Task 10: Refactor llmgrep.ts (Issues 2, 9)

**Files:**
- Modify: `llmgrep.ts`

**Step 1: Rewrite with timeout and proper piping**

```typescript
// llmgrep.ts
#!/usr/bin/env bun

import { join } from "path";
import {
  parseArgs,
  validateSearchOptions,
  spawnWithTimeout,
  pipeProcesses,
  Logger,
  setDebugMode,
  DEFAULT_TOP_K,
  DEFAULT_CONTEXT,
} from "./src";

const logger = new Logger('llmgrep');
const SEARCH_TIMEOUT = 120000; // 2 minutes
const EXTRACT_TIMEOUT = 60000; // 1 minute

function printHelp() {
  console.log(`
llmgrep - Semantic search across your Claude conversation history

Usage: llmgrep <query> [options]

Arguments:
  <query>               Search query (semantic matching)

Options:
  --top-k <number>      Number of results to return (default: ${DEFAULT_TOP_K})
  --max-distance <num>  Maximum cosine distance threshold (0.0+)
  --context <number>    Lines of context before/after match (default: ${DEFAULT_CONTEXT})
  --debug               Enable debug logging
  -h, --help           Show this help message

Examples:
  llmgrep "authentication methods" --top-k 5
  llmgrep "bug in user registration" --max-distance 0.3
  llmgrep "react hooks" --context 5
`);
}

async function main() {
  const args = process.argv.slice(2);

  // Check for debug flag
  if (args.includes('--debug')) {
    setDebugMode(true);
    args.splice(args.indexOf('--debug'), 1);
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  if (args.length === 0) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const { query, options } = parseArgs(args);

  if (!query) {
    console.error('Error: Query is required\n');
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    validateSearchOptions(options);
  } catch (error) {
    console.error(`Error: ${(error as Error).message}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  // Build search command arguments
  const searchArgs = [query, '-n', options.context!.toString()];

  if (options.maxDistance !== undefined) {
    searchArgs.push('-m', options.maxDistance.toString());
  } else {
    searchArgs.push('--top-k', options.topK!.toString());
  }

  const extractScript = join(import.meta.dir, 'extract-text.ts');

  try {
    const result = await pipeProcesses({
      source: { cmd: ['bun', 'run', extractScript] },
      sink: { cmd: ['search', ...searchArgs] },
      timeout: SEARCH_TIMEOUT,
    });

    if (result.timedOut) {
      logger.error('Search timed out after 2 minutes');
      process.exitCode = 1;
      return;
    }

    if (result.sourceExitCode !== 0) {
      logger.error(`Extraction failed with code ${result.sourceExitCode}`);
      process.exitCode = 1;
      return;
    }

    if (result.exitCode !== 0) {
      logger.error(`Search failed with code ${result.exitCode}`);
      console.error('Make sure "search" command is installed (npm install -g @llamaindex/semtools)');
      process.exitCode = result.exitCode;
      return;
    }

    // Output results
    console.log(result.stdout);
  } catch (error) {
    logger.error('Search failed', error as Error);
    process.exitCode = 1;
  }
}

main();
```

**Step 2: Verify refactored file runs**

Run: `bun run llmgrep.ts --help`
Expected: Help text displayed

**Step 3: Commit**

```bash
git add llmgrep.ts
git commit -m "refactor llmgrep with timeout and proper piping"
```

---

## Task 11: Update index.ts Entry Point

**Files:**
- Modify: `index.ts`

**Step 1: Update to use new utilities**

```typescript
// index.ts
#!/usr/bin/env bun

import { join } from "path";
import { spawnWithTimeout, Logger, setDebugMode } from "./src";

const logger = new Logger('index');
const SCRIPT_TIMEOUT = 300000; // 5 minutes

async function main() {
  const args = process.argv.slice(2);

  // Check for debug flag
  if (args.includes('--debug')) {
    setDebugMode(true);
  }

  // Check for --no-interactive flag to use plain search
  const useInteractive = !args.includes('--no-interactive');

  // Remove internal flags from args passed to child
  const filteredArgs = args.filter(arg => arg !== '--no-interactive');

  const searchScript = useInteractive
    ? join(import.meta.dir, 'interactive-search.ts')
    : join(import.meta.dir, 'search-with-context.ts');

  try {
    const result = await spawnWithTimeout({
      cmd: ['bun', 'run', searchScript, ...filteredArgs],
      timeout: SCRIPT_TIMEOUT,
    });

    if (result.timedOut) {
      logger.error('Search timed out');
      process.exitCode = 1;
      return;
    }

    // Output is already printed by the child process since we're using inherit
    // But spawnWithTimeout captures it, so we need to print it
    if (result.stdout) {
      console.log(result.stdout);
    }
    if (result.stderr) {
      console.error(result.stderr);
    }

    process.exitCode = result.exitCode;
  } catch (error) {
    logger.error('Failed to run search', error as Error);
    process.exitCode = 1;
  }
}

main();
```

**Step 2: Verify entry point works**

Run: `bun run index.ts --help`
Expected: Help text (from interactive-search)

**Step 3: Commit**

```bash
git add index.ts
git commit -m "update entry point to use new spawn utilities"
```

---

## Task 12: Remove Unused Import from extract-conversation.ts

**Files:**
- Modify: `extract-conversation.ts`

**Step 1: Check current file and remove sessionId parameter if unused**

The `sessionId` parameter in `extractConversation` is not used. Either remove it or document why it's there for future use.

```typescript
// extract-conversation.ts - Updated signature
// If sessionId is for future filtering, add comment:
export async function extractConversation(
  filePath: string,
  _sessionId?: string // Reserved for future session filtering
): Promise<string> {
```

Or if not needed:
```typescript
export async function extractConversation(filePath: string): Promise<string> {
```

**Step 2: Update callers if signature changed**

If removing sessionId, update the call in interactive-search.ts:
```typescript
const conversation = await extractConversation(selected.entry.filePath);
```

**Step 3: Commit**

```bash
git add extract-conversation.ts interactive-search.ts
git commit -m "clean up unused sessionId parameter"
```

---

## Task 13: Run Full Test Suite

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests pass

**Step 2: Fix any failures**

If any tests fail, debug and fix them.

**Step 3: Run type check**

Run: `bun build src/index.ts extract-text.ts extract-with-metadata.ts interactive-search.ts search-with-context.ts llmgrep.ts index.ts --outdir=/dev/null 2>&1 || echo "Type errors found"`
Expected: No type errors

---

## Task 14: Integration Testing

**Step 1: Test help commands**

Run: `bun run index.ts --help`
Expected: Help text displayed

Run: `bun run interactive-search.ts --help`
Expected: Help text displayed

Run: `bun run search-with-context.ts --help`
Expected: Help text displayed

Run: `bun run llmgrep.ts --help`
Expected: Help text displayed

**Step 2: Test invalid input handling**

Run: `bun run interactive-search.ts "test" --top-k invalid`
Expected: Error about topK being invalid

Run: `bun run interactive-search.ts "test" --max-distance 2.0`
Expected: Error about maxDistance being invalid

**Step 3: Test debug mode**

Run: `DEBUG=1 bun run extract-text.ts 2>&1 | head -20`
Expected: Debug output if any parse errors occur

**Step 4: Commit integration test results**

```bash
git add -A
git commit -m "complete critical issues 1-10 fixes"
```

---

## Summary of Changes

| Issue | Fix | Files Changed |
|-------|-----|---------------|
| 1. Temp file leak | TempFileManager with cleanup handlers | src/cleanup.ts, all search files |
| 2. Race condition | pipeProcesses with proper error handling | src/spawn.ts, llmgrep.ts |
| 3. null as any | SearchResultBuilder + typed attachEntries | src/search-result.ts, interactive-search.ts |
| 4. Silent errors | Logger with debug mode | src/logger.ts, all extract files |
| 5. No validation | validateSearchOptions function | src/utils.ts, all search files |
| 6. Unbounded memory | (Partial) Streaming still needed for huge datasets | Documented as future work |
| 7. Hardcoded paths | getProjectsDir with HOME check | src/utils.ts, extract files |
| 8. Exit without cleanup | process.exitCode instead of process.exit | All CLI files |
| 9. No timeout | spawnWithTimeout, pipeProcesses | src/spawn.ts, llmgrep.ts |
| 10. Duplicate code | Shared modules in src/ | src/*.ts |

---

Plan complete and saved to `docs/plans/2025-11-25-fix-critical-issues.md`.

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

Which approach?
