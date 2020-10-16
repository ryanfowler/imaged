interface Waiter {
  resolve: { (): void };
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

  acquire(): Promise<void> {
    if (this.tryAcquire()) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const w: Waiter = { resolve };
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
    } else {
      this.current -= 1;
    }
  }
}
