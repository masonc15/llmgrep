// src/spinner.ts

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL = 80;

export class Spinner {
  private frameIndex = 0;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private message: string;
  private stream: NodeJS.WriteStream;

  constructor(message: string, stream: NodeJS.WriteStream = process.stderr) {
    this.message = message;
    this.stream = stream;
  }

  start(): this {
    if (this.intervalId) return this;

    // Hide cursor
    this.stream.write('\x1B[?25l');

    this.render();
    this.intervalId = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
      this.render();
    }, FRAME_INTERVAL);

    return this;
  }

  private render(): void {
    const frame = SPINNER_FRAMES[this.frameIndex];
    // Clear line and write spinner
    this.stream.write(`\r\x1B[K${frame} ${this.message}`);
  }

  update(message: string): this {
    this.message = message;
    if (this.intervalId) {
      this.render();
    }
    return this;
  }

  stop(finalMessage?: string): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Clear spinner line
    this.stream.write('\r\x1B[K');

    // Show cursor
    this.stream.write('\x1B[?25h');

    if (finalMessage) {
      this.stream.write(`${finalMessage}\n`);
    }
  }

  succeed(message?: string): void {
    this.stop(`✓ ${message ?? this.message}`);
  }

  fail(message?: string): void {
    this.stop(`✗ ${message ?? this.message}`);
  }
}

export function createSpinner(message: string): Spinner {
  return new Spinner(message);
}
