// src/spawn.ts
import { getGlobalProcessManager } from "./cleanup";

export interface SpawnOptions {
  cmd: string[];
  timeout: number;
  stdin?: ReadableStream | string;
  cwd?: string;
}

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface PipeOptions {
  source: { cmd: string[]; cwd?: string };
  sink: { cmd: string[]; cwd?: string };
  timeout: number;
}

export interface PipeResult {
  exitCode: number;
  sourceExitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function spawnWithTimeout(options: SpawnOptions): Promise<SpawnResult> {
  const { cmd, timeout, stdin, cwd } = options;
  const processManager = getGlobalProcessManager();

  const proc = Bun.spawn(cmd, {
    cwd,
    stdin: stdin instanceof ReadableStream ? stdin : (stdin ? new Response(stdin).body : undefined),
    stdout: "pipe",
    stderr: "pipe",
  });

  processManager.track(proc);

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  try {
    const [exitCode, stdoutText, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    clearTimeout(timeoutId);

    return {
      exitCode,
      stdout: stdoutText,
      stderr: stderrText,
      timedOut,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export async function pipeProcesses(options: PipeOptions): Promise<PipeResult> {
  const { source, sink, timeout } = options;
  const processManager = getGlobalProcessManager();

  const sourceProc = Bun.spawn(source.cmd, {
    cwd: source.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  processManager.track(sourceProc);

  const sinkProc = Bun.spawn(sink.cmd, {
    cwd: sink.cwd,
    stdin: sourceProc.stdout,
    stdout: "pipe",
    stderr: "pipe",
  });

  processManager.track(sinkProc);

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    sourceProc.kill();
    sinkProc.kill();
  }, timeout);

  try {
    const [sourceExitCode, sinkExitCode, stdoutText, stderrText] = await Promise.all([
      sourceProc.exited,
      sinkProc.exited,
      new Response(sinkProc.stdout).text(),
      new Response(sinkProc.stderr).text(),
    ]);

    clearTimeout(timeoutId);

    return {
      exitCode: sinkExitCode,
      sourceExitCode,
      stdout: stdoutText,
      stderr: stderrText,
      timedOut,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    sourceProc.kill();
    sinkProc.kill();
    throw error;
  }
}
