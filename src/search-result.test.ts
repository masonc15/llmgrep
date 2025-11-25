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
