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
