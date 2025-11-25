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
