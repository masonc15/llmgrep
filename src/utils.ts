// src/utils.ts
import { join } from "path";
import type { SearchOptions, ParsedArgs } from "./types";
import {
  DEFAULT_TOP_K,
  DEFAULT_CONTEXT,
  DEFAULT_LIMIT,
  THRESHOLD_STRICT,
  THRESHOLD_PRECISE,
  THRESHOLD_BROAD,
} from "./types";

export function parseDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}. Use YYYY-MM-DD.`);
  }
  return date;
}

export function parseArgs(args: string[], defaults?: Partial<SearchOptions>): ParsedArgs {
  const options: SearchOptions = {
    topK: defaults?.topK ?? DEFAULT_TOP_K,
    context: defaults?.context ?? DEFAULT_CONTEXT,
    limit: defaults?.limit ?? DEFAULT_LIMIT,
  };

  let query = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Human-friendly threshold aliases
    if (arg === '--strict' || arg === '-s') {
      options.maxDistance = THRESHOLD_STRICT;
    } else if (arg === '--precise' || arg === '-p') {
      options.maxDistance = THRESHOLD_PRECISE;
    } else if (arg === '--broad' || arg === '-b') {
      options.maxDistance = THRESHOLD_BROAD;
    } else if ((arg === '--max-distance' || arg === '-m') && i + 1 < args.length) {
      options.maxDistance = parseFloat(args[++i]!);
    } else if (arg === '--top-k' && i + 1 < args.length) {
      options.topK = parseInt(args[++i]!, 10);
    } else if ((arg === '--limit' || arg === '-l') && i + 1 < args.length) {
      options.limit = parseInt(args[++i]!, 10);
    } else if (arg === '--context' && i + 1 < args.length) {
      options.context = parseInt(args[++i]!, 10);
    } else if (arg === '--after' && i + 1 < args.length) {
      options.afterDate = parseDate(args[++i]!);
    } else if (arg === '--before' && i + 1 < args.length) {
      options.beforeDate = parseDate(args[++i]!);
    } else if (arg === '--help' || arg === '-h') {
      // Handled by caller
      continue;
    } else if (!arg!.startsWith('--') && !arg!.startsWith('-')) {
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

  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit <= 0) {
      throw new Error("limit must be a positive integer");
    }
  }

  if (options.afterDate && options.beforeDate) {
    if (options.afterDate >= options.beforeDate) {
      throw new Error("--after date must be before --before date");
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

// Convert cosine distance (0-1) to percentage (100-0%)
// Lower distance = higher relevance
export function distanceToPercent(distance: number): number {
  return Math.round((1 - distance) * 100);
}

// Create visual bar representation (10 chars wide)
export function createVisualBar(percent: number): string {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// Format a result line for display
export function formatResultLine(
  percent: number,
  date: Date | undefined,
  folder: string,
  preview: string,
  homeDir?: string
): string {
  const bar = createVisualBar(percent);
  const percentStr = `${percent}%`.padStart(4);

  // Format date as "Nov 24" style
  const dateStr = date
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).padEnd(7)
    : '       ';

  // Format folder - show (home) if it's the user's home or catch-all
  let folderStr = folder;
  if (homeDir && (folder === homeDir || folder.includes('Users-') || folder === '-')) {
    folderStr = '(home)';
  }
  folderStr = folderStr.substring(0, 18).padEnd(18);

  return ` ${bar} ${percentStr}  ${dateStr} ${folderStr} "${preview}"`;
}

// Filter results by date range
export function filterByDateRange<T extends { timestamp?: string }>(
  entries: T[],
  afterDate?: Date,
  beforeDate?: Date
): T[] {
  if (!afterDate && !beforeDate) return entries;

  return entries.filter(entry => {
    if (!entry.timestamp) return true; // Keep entries without timestamps
    const entryDate = new Date(entry.timestamp);
    if (afterDate && entryDate < afterDate) return false;
    if (beforeDate && entryDate > beforeDate) return false;
    return true;
  });
}
