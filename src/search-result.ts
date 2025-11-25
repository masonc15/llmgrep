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
