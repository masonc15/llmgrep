// src/utils.test.ts
import { describe, test, expect } from "bun:test";
import {
  parseArgs,
  validateSearchOptions,
  getProjectsDir,
  parseDate,
  distanceToPercent,
  createVisualBar,
  filterByDateRange,
} from "./utils";
import { THRESHOLD_STRICT, THRESHOLD_PRECISE, THRESHOLD_BROAD } from "./types";

describe("parseArgs", () => {
  test("parses query without flags", () => {
    const result = parseArgs(["search term"]);
    expect(result.query).toBe("search term");
    expect(result.options.topK).toBe(3);
    expect(result.options.context).toBe(3);
    expect(result.options.limit).toBe(10);
  });

  test("parses --top-k flag", () => {
    const result = parseArgs(["query", "--top-k", "10"]);
    expect(result.options.topK).toBe(10);
  });

  test("parses --max-distance flag", () => {
    const result = parseArgs(["query", "--max-distance", "0.5"]);
    expect(result.options.maxDistance).toBe(0.5);
  });

  test("parses -m short flag for max-distance", () => {
    const result = parseArgs(["query", "-m", "0.35"]);
    expect(result.options.maxDistance).toBe(0.35);
  });

  test("parses --context flag", () => {
    const result = parseArgs(["query", "--context", "5"]);
    expect(result.options.context).toBe(5);
  });

  test("returns null query when missing", () => {
    const result = parseArgs(["--top-k", "5"]);
    expect(result.query).toBe("");
  });

  // Human-friendly threshold flags
  test("parses --strict flag", () => {
    const result = parseArgs(["query", "--strict"]);
    expect(result.options.maxDistance).toBe(THRESHOLD_STRICT);
  });

  test("parses -s short flag for strict", () => {
    const result = parseArgs(["query", "-s"]);
    expect(result.options.maxDistance).toBe(THRESHOLD_STRICT);
  });

  test("parses --precise flag", () => {
    const result = parseArgs(["query", "--precise"]);
    expect(result.options.maxDistance).toBe(THRESHOLD_PRECISE);
  });

  test("parses -p short flag for precise", () => {
    const result = parseArgs(["query", "-p"]);
    expect(result.options.maxDistance).toBe(THRESHOLD_PRECISE);
  });

  test("parses --broad flag", () => {
    const result = parseArgs(["query", "--broad"]);
    expect(result.options.maxDistance).toBe(THRESHOLD_BROAD);
  });

  test("parses -b short flag for broad", () => {
    const result = parseArgs(["query", "-b"]);
    expect(result.options.maxDistance).toBe(THRESHOLD_BROAD);
  });

  // Limit flag
  test("parses --limit flag", () => {
    const result = parseArgs(["query", "--limit", "5"]);
    expect(result.options.limit).toBe(5);
  });

  test("parses -l short flag for limit", () => {
    const result = parseArgs(["query", "-l", "20"]);
    expect(result.options.limit).toBe(20);
  });

  // Date flags
  test("parses --after flag", () => {
    const result = parseArgs(["query", "--after", "2025-01-15"]);
    expect(result.options.afterDate).toBeInstanceOf(Date);
    expect(result.options.afterDate?.toISOString().slice(0, 10)).toBe("2025-01-15");
  });

  test("parses --before flag", () => {
    const result = parseArgs(["query", "--before", "2025-01-20"]);
    expect(result.options.beforeDate).toBeInstanceOf(Date);
    expect(result.options.beforeDate?.toISOString().slice(0, 10)).toBe("2025-01-20");
  });

  test("parses both --after and --before", () => {
    const result = parseArgs(["query", "--after", "2025-01-01", "--before", "2025-01-31"]);
    expect(result.options.afterDate).toBeInstanceOf(Date);
    expect(result.options.beforeDate).toBeInstanceOf(Date);
  });
});

describe("parseDate", () => {
  test("parses valid YYYY-MM-DD", () => {
    const date = parseDate("2025-01-15");
    expect(date).toBeInstanceOf(Date);
  });

  test("throws on invalid date", () => {
    expect(() => parseDate("not-a-date")).toThrow("Invalid date format");
  });
});

describe("validateSearchOptions", () => {
  test("throws on invalid limit", () => {
    expect(() => validateSearchOptions({ limit: -1 })).toThrow("limit must be a positive integer");
  });

  test("throws on zero limit", () => {
    expect(() => validateSearchOptions({ limit: 0 })).toThrow("limit must be a positive integer");
  });

  test("throws when after >= before", () => {
    expect(() => validateSearchOptions({
      afterDate: new Date("2025-01-20"),
      beforeDate: new Date("2025-01-10"),
    })).toThrow("--after date must be before --before date");
  });

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

describe("distanceToPercent", () => {
  test("converts 0 distance to 100%", () => {
    expect(distanceToPercent(0)).toBe(100);
  });

  test("converts 1 distance to 0%", () => {
    expect(distanceToPercent(1)).toBe(0);
  });

  test("converts 0.3 distance to 70%", () => {
    expect(distanceToPercent(0.3)).toBe(70);
  });

  test("converts 0.45 distance to 55%", () => {
    expect(distanceToPercent(0.45)).toBe(55);
  });
});

describe("createVisualBar", () => {
  test("creates full bar for 100%", () => {
    expect(createVisualBar(100)).toBe("██████████");
  });

  test("creates empty bar for 0%", () => {
    expect(createVisualBar(0)).toBe("░░░░░░░░░░");
  });

  test("creates half bar for 50%", () => {
    expect(createVisualBar(50)).toBe("█████░░░░░");
  });

  test("creates 8/10 bar for 80%", () => {
    expect(createVisualBar(80)).toBe("████████░░");
  });
});

describe("filterByDateRange", () => {
  const entries = [
    { id: 1, timestamp: "2025-01-10T00:00:00Z" },
    { id: 2, timestamp: "2025-01-15T00:00:00Z" },
    { id: 3, timestamp: "2025-01-20T00:00:00Z" },
    { id: 4 }, // no timestamp
  ];

  test("returns all when no dates specified", () => {
    const result = filterByDateRange(entries);
    expect(result).toHaveLength(4);
  });

  test("filters by afterDate", () => {
    const result = filterByDateRange(entries, new Date("2025-01-12"));
    expect(result).toHaveLength(3); // 2, 3, 4 (no timestamp kept)
  });

  test("filters by beforeDate", () => {
    const result = filterByDateRange(entries, undefined, new Date("2025-01-17"));
    expect(result).toHaveLength(3); // 1, 2, 4 (no timestamp kept)
  });

  test("filters by date range", () => {
    const result = filterByDateRange(entries, new Date("2025-01-12"), new Date("2025-01-18"));
    expect(result).toHaveLength(2); // 2, 4 (no timestamp kept)
  });

  test("keeps entries without timestamps", () => {
    const result = filterByDateRange(entries, new Date("2025-01-25"));
    expect(result).toHaveLength(1); // only entry 4 (no timestamp)
  });
});
