import type { Options } from "./options";
import type { Job, JobResult, WorkerMessage } from "./worker";

interface Pending {
  job: Job;
  resolve: (result: JobResult) => void;
}

/**
 * A few background workers that process photos in parallel. Each holds its own copy of the
 * WebAssembly module. The count is capped because a large photo needs a few hundred MB while
 * it's being resized.
 */
export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Pending[] = [];
  private readonly running = new Map<Worker, Pending>();
  private nextId = 1;
  readonly ready: Promise<string[]>;

  constructor(size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1))) {
    const readies: Promise<string[]>[] = [];
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      readies.push(
        new Promise((resolve) => {
          worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
            if (event.data.type === "ready") resolve(event.data.urls);
            else this.finish(worker, event.data.result);
          });
        }),
      );
      worker.addEventListener("error", () => {
        const pending = this.running.get(worker);
        if (pending) this.finish(worker, { id: pending.job.id, ok: false, error: "The image worker stopped unexpectedly" });
      });
      this.workers.push(worker);
      this.idle.push(worker);
    }
    this.ready = Promise.all(readies).then((lists) => [...new Set(lists.flat())]);
  }

  process(file: File, options: Options): Promise<JobResult> {
    return new Promise((resolve) => {
      this.queue.push({ job: { id: this.nextId++, file, options }, resolve });
      this.pump();
    });
  }

  /** Drops jobs that haven't started yet, for example after the settings change. */
  clearQueue(): void {
    for (const pending of this.queue.splice(0)) pending.resolve({ id: pending.job.id, ok: false, error: "cancelled" });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const worker = this.idle.pop()!;
      const pending = this.queue.shift()!;
      this.running.set(worker, pending);
      worker.postMessage(pending.job);
    }
  }

  private finish(worker: Worker, result: JobResult): void {
    const pending = this.running.get(worker);
    this.running.delete(worker);
    this.idle.push(worker);
    pending?.resolve(result);
    this.pump();
  }
}
