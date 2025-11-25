// src/cleanup.ts
import { tmpdir } from "os";
import { join } from "path";
import { unlink } from "fs/promises";
import type { Subprocess } from "bun";

export class TempFileManager {
  private files: Set<string> = new Set();

  async create(prefix: string): Promise<string> {
    const path = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    await Bun.write(path, "");
    this.files.add(path);
    return path;
  }

  getTrackedFiles(): string[] {
    return Array.from(this.files);
  }

  async cleanup(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      // File may already be deleted, ignore
    }
    this.files.delete(path);
  }

  async cleanupAll(): Promise<void> {
    const paths = Array.from(this.files);
    await Promise.all(paths.map(path => this.cleanup(path)));
  }
}

export class ProcessManager {
  private processes: Set<Subprocess> = new Set();

  track(proc: Subprocess): void {
    this.processes.add(proc);

    // Auto-remove when process exits
    proc.exited.then(() => {
      this.processes.delete(proc);
    }).catch(() => {
      this.processes.delete(proc);
    });
  }

  getTrackedProcesses(): Subprocess[] {
    return Array.from(this.processes);
  }

  kill(proc: Subprocess): void {
    try {
      proc.kill();
    } catch {
      // Process may already be dead
    }
    this.processes.delete(proc);
  }

  killAll(): void {
    for (const proc of this.processes) {
      this.kill(proc);
    }
  }
}

// Global instances for cleanup on process exit
const globalTempManager = new TempFileManager();
const globalProcessManager = new ProcessManager();

export function getGlobalTempManager(): TempFileManager {
  return globalTempManager;
}

export function getGlobalProcessManager(): ProcessManager {
  return globalProcessManager;
}

// Register cleanup handlers
function setupCleanupHandlers(): void {
  const cleanup = async () => {
    globalProcessManager.killAll();
    await globalTempManager.cleanupAll();
  };

  process.on('exit', () => {
    globalProcessManager.killAll();
    // Can't await in exit handler, but files will be cleaned by OS eventually
  });

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(130);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(143);
  });

  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await cleanup();
    process.exit(1);
  });
}

setupCleanupHandlers();
