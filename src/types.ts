// src/types.ts

export interface SearchOptions {
  topK?: number;
  maxDistance?: number;
  context?: number;
  afterDate?: Date;
  beforeDate?: Date;
  limit?: number;
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

// Human-friendly threshold presets
export const THRESHOLD_STRICT = 0.30;   // --strict: exact/very close matches
export const THRESHOLD_PRECISE = 0.40;  // --precise: high quality (default)
export const THRESHOLD_BROAD = 0.55;    // --broad: cast wider net

// New defaults for v2 UX
export const DEFAULT_DISTANCE = THRESHOLD_PRECISE;
export const DEFAULT_LIMIT = 10;
export const EXPANDED_DISTANCE = THRESHOLD_BROAD;  // for auto-expand
