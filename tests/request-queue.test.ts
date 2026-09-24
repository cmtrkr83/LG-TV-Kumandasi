import { describe, expect, it, vi } from "vitest";
import {
  QueueBackpressureError,
  QueueClosedError,
  SerialRequestQueue,
} from "../artifacts/netcast-remote/protocol/requestQueue";

function deferred() {
  let resolve!: () => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("SerialRequestQueue", () => {
  it("runs regular tasks one at a time", async () => {
    const queue = new SerialRequestQueue();
    const started = deferred();
    const release = deferred();
    const calls: string[] = [];

    const first = queue.enqueue(async () => {
      calls.push("first");
      started.resolve();
      await release.promise;
    });
    await started.promise;
    const second = queue.enqueue(async () => {
      calls.push("second");
    });

    expect(queue.inFlight).toBe(true);
    expect(calls).toEqual(["first"]);
    release.resolve();
    await Promise.all([first, second]);
    expect(calls).toEqual(["first", "second"]);
    expect(queue.inFlight).toBe(false);
  });

  it("coalesces pending touch movement entries", async () => {
    const moved = deferred();
    const release = deferred();
    const started = deferred();
    const moveTask = vi.fn(async (dx: number, dy: number) => {
      moved.resolve();
      expect([dx, dy]).toEqual([14, 3]);
    });
    const queue = new SerialRequestQueue({ moveTask });
    const blockingTask = queue.enqueue(async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;

    expect(queue.enqueueMove(10, 5)).toBe(true);
    expect(queue.enqueueMove(4, -2)).toBe(true);
    expect(queue.pendingCount).toBe(1);
    release.resolve();
    await blockingTask;
    await moved.promise;
    expect(moveTask).toHaveBeenCalledTimes(1);
  });

  it("rejects work when the pending limit is reached", async () => {
    const onBackpressure = vi.fn();
    const queue = new SerialRequestQueue({
      maxPendingEntries: 1,
      onBackpressure,
    });
    const started = deferred();
    const release = deferred();
    const active = queue.enqueue(async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;

    const accepted = queue.enqueue(async () => undefined);
    const rejected = queue.enqueue(async () => undefined);
    await expect(rejected).rejects.toBeInstanceOf(QueueBackpressureError);
    expect(onBackpressure).toHaveBeenCalledTimes(1);

    release.resolve();
    await Promise.all([active, accepted]);
  });

  it("flushes movement before a following non-move task", async () => {
    const events: string[] = [];
    const queue = new SerialRequestQueue({
      moveTask: async () => {
        events.push("move");
      },
    });
    queue.enqueueMove(3, 4);
    const command = queue.enqueue(async () => {
      events.push("command");
    });

    await command;
    expect(events).toEqual(["move", "command"]);
  });

  it("keeps only the latest pending task for a keyed command", async () => {
    const queue = new SerialRequestQueue();
    const started = deferred();
    const release = deferred();
    const calls: string[] = [];
    const token = {};

    const active = queue.enqueue(async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;

    const firstRepeat = queue.enqueue(
      async () => {
        calls.push("first-repeat");
      },
      { key: 7, token },
    );
    const latestRepeat = queue.enqueue(
      async () => {
        calls.push("latest-repeat");
      },
      { key: 7, token },
    );

    expect(queue.pendingCount).toBe(1);
    release.resolve();
    await Promise.all([active, firstRepeat, latestRepeat]);
    expect(calls).toEqual(["latest-repeat"]);
  });

  it("cancels only the matching pending repeat", async () => {
    const queue = new SerialRequestQueue();
    const started = deferred();
    const release = deferred();
    const token = {};
    const otherToken = {};
    const calls: string[] = [];

    const active = queue.enqueue(async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;
    const pending = queue.enqueue(
      async () => {
        calls.push("cancelled");
      },
      { key: 9, token },
    );
    queue.enqueue(
      async () => {
        calls.push("other");
      },
      { key: 9, token: otherToken },
    );

    queue.cancel(9, token);
    release.resolve();
    await Promise.all([active, pending]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["other"]);
  });

  it("aborts active work and rejects future work when cleared", async () => {
    const queue = new SerialRequestQueue();
    const started = deferred();
    let activeSignal: AbortSignal | undefined;
    const active = queue.enqueue((signal) => {
      activeSignal = signal;
      started.resolve();
      return new Promise<void>((_, rejectPromise) => {
        signal.addEventListener(
          "abort",
          () => rejectPromise(new Error("aborted")),
          { once: true },
        );
      });
    });
    await started.promise;

    queue.clear();

    expect(activeSignal?.aborted).toBe(true);
    await expect(active).rejects.toBeInstanceOf(QueueClosedError);
    await expect(queue.enqueue(async () => undefined)).rejects.toBeInstanceOf(
      QueueClosedError,
    );
  });
});
