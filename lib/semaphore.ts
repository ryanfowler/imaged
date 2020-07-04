interface Waiter {
  resolve: { (): void };
  timer?: NodeJS.Timeout;
}

export class Semaphore {
  private current = 0;
  private readonly size: number;
  private queue: Waiter[] = [];

  constructor(size: number) {
    if (size < 1) {
      throw new Error(`semaphore: invalid limit '${size}'`);
    }
    this.size = size;
  }

  acquire(timeoutMs?: number): Promise<void> {
    if (this.tryAcquire()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const w: Waiter = { resolve };
      if (timeoutMs) {
        w.timer = setTimeout(() => {
          reject(new Error("semaphore: acquire timeout"));
          this.queue = this.queue.filter((val) => {
            return val !== w;
          });
        }, timeoutMs);
      }
      this.queue.push(w);
    });
  }

  tryAcquire(): boolean {
    if (this.current < this.size) {
      this.current += 1;
      return true;
    }
    return false;
  }

  release(): void {
    if (this.current < 1) {
      throw new Error("semaphore: invalid release");
    }
    const next = this.queue.shift();
    if (next) {
      next.resolve();
      if (next.timer) {
        clearTimeout(next.timer);
      }
    } else {
      this.current -= 1;
    }
  }
}
