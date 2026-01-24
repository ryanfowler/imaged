import { describe, test, expect } from "bun:test";
import { Semaphore } from "./semaphore.ts";

describe("Semaphore", () => {
  describe("constructor", () => {
    test("throws on invalid limit", () => {
      expect(() => new Semaphore(0)).toThrow(/invalid limit/);
      expect(() => new Semaphore(-1)).toThrow(/invalid limit/);
    });

    test("creates with valid limit", () => {
      const sema = new Semaphore(1);
      expect(sema).toBeInstanceOf(Semaphore);
    });
  });

  describe("acquire", () => {
    test("returns resolved promise when under limit", async () => {
      const sema = new Semaphore(2);
      const result1 = await sema.acquire();
      const result2 = await sema.acquire();
      expect(result1).toBeUndefined();
      expect(result2).toBeUndefined();
    });

    test("blocks when at limit", async () => {
      const sema = new Semaphore(1);
      await sema.acquire();

      let acquired = false;
      const pending = sema.acquire().then(() => {
        acquired = true;
      });

      // Give time for the promise to resolve if it would
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(acquired).toBe(false);

      // Release should unblock
      sema.release();
      await pending;
      expect(acquired).toBe(true);
    });

    test("queues multiple waiters in FIFO order", async () => {
      const sema = new Semaphore(1);
      await sema.acquire();

      const order: number[] = [];

      const p1 = sema.acquire().then(() => order.push(1));
      const p2 = sema.acquire().then(() => order.push(2));
      const p3 = sema.acquire().then(() => order.push(3));

      // Release all three
      sema.release();
      await p1;
      sema.release();
      await p2;
      sema.release();
      await p3;

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe("release", () => {
    test("throws on invalid release", () => {
      const sema = new Semaphore(1);
      expect(() => sema.release()).toThrow(/invalid release/);
    });

    test("decrements count when no waiters", async () => {
      const sema = new Semaphore(2);
      await sema.acquire();
      await sema.acquire();

      // Should not throw
      sema.release();
      sema.release();

      // Should be able to acquire again
      await sema.acquire();
    });

    test("transfers permit to waiter without decrementing", async () => {
      const sema = new Semaphore(1);
      await sema.acquire();

      let waiterResolved = false;
      const waiter = sema.acquire().then(() => {
        waiterResolved = true;
      });

      sema.release();
      await waiter;

      expect(waiterResolved).toBe(true);

      // After the waiter gets the permit, only one release should be needed
      sema.release();

      // Now acquiring should work immediately
      await sema.acquire();
    });
  });

  describe("queue growth", () => {
    test("handles more waiters than initial capacity", async () => {
      const sema = new Semaphore(1, 2); // Small initial queue capacity
      await sema.acquire();

      const waiters: Promise<void>[] = [];
      const results: number[] = [];

      // Queue up more than initial capacity
      for (let i = 0; i < 10; i++) {
        waiters.push(
          sema.acquire().then(() => {
            results.push(i);
          }),
        );
      }

      // Release all
      for (let i = 0; i < 10; i++) {
        sema.release();
        await waiters[i];
      }

      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe("concurrency", () => {
    test("limits concurrent operations", async () => {
      const sema = new Semaphore(3);
      let concurrent = 0;
      let maxConcurrent = 0;

      const work = async (delay: number) => {
        await sema.acquire();
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, delay));
        concurrent--;
        sema.release();
      };

      // Start 10 concurrent tasks
      const tasks = Array.from({ length: 10 }, (_, i) => work(20));
      await Promise.all(tasks);

      expect(maxConcurrent).toBe(3);
      expect(concurrent).toBe(0);
    });
  });
});
