#!/usr/bin/env bun

import { spawn } from "child_process";
import { join } from "path";
import { setDebugMode } from "./src";

// Main entry point - delegates to interactive-search.ts by default
// Uses stdio: 'inherit' to preserve interactive prompts

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

  const proc = spawn('bun', ['run', searchScript, ...filteredArgs], {
    stdio: 'inherit',
  });

  proc.on('exit', (code) => {
    process.exitCode = code || 0;
  });

  proc.on('error', (error) => {
    console.error('Failed to start search:', error.message);
    process.exitCode = 1;
  });
}

main();
