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
