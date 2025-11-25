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
