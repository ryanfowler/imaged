export class Semaphore {
  private current = 0;
  private readonly size: number;

  // Ring buffer of resolvers (power-of-two capacity)
  private q: Array<(() => void) | undefined>;
  private head = 0;
  private tail = 0;
  private mask: number;

  // Reuse for uncontended acquire
  private static readonly RESOLVED: Promise<void> = Promise.resolve();

  constructor(size: number, initialQueueCapacity = 64) {
    if (size < 1) throw new Error(`semaphore: invalid limit '${size}'`);
    this.size = size;

    // round up to power of two
    let cap = 1;
    while (cap < initialQueueCapacity) cap <<= 1;

    this.q = new Array(cap);
    this.mask = cap - 1;
  }

  acquire(): Promise<void> {
    if (this.current < this.size) {
      this.current++;
      return Semaphore.RESOLVED;
    }

    return new Promise<void>((resolve) => {
      this.enqueue(resolve);
    });
  }

  release(): void {
    if (this.current < 1) throw new Error("semaphore: invalid release");

    const r = this.dequeue();
    if (r) {
      // Permit is transferred directly to the waiter:
      // current stays the same (still "held" by the woken task).
      r();
    } else {
      this.current--;
    }
  }

  private enqueue(r: () => void) {
    // full when (tail - head) == capacity
    if (this.tail - this.head >= this.mask + 1) this.grow();

    this.q[this.tail & this.mask] = r;
    this.tail++;
  }

  private dequeue(): (() => void) | undefined {
    if (this.head === this.tail) return undefined;

    const idx = this.head & this.mask;
    const r = this.q[idx];
    this.q[idx] = undefined; // help GC
    this.head++;
    return r;
  }

  private grow() {
    const oldQ = this.q;
    const oldCap = oldQ.length;
    const newCap = oldCap << 1;
    const newQ = new Array<(() => void) | undefined>(newCap);

    // copy live items [head, tail) into newQ starting at 0
    const n = this.tail - this.head;
    for (let i = 0; i < n; i++) {
      newQ[i] = oldQ[(this.head + i) & this.mask];
    }

    this.q = newQ;
    this.head = 0;
    this.tail = n;
    this.mask = newCap - 1;
  }
}
