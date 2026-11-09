type Task = { key: string; priority: number; run: () => Promise<void>; promise: Promise<void>; resolve: () => void; reject: (e: unknown) => void };

export const PRIORITY = { prefetch: 0, listening: 1 } as const;

/**
 * Hàng đợi TTS 1 luồng (VieNeu trên CPU trả 429 nếu gửi song song).
 * - Cùng key (hash) chỉ tạo 1 lần: gọi lại sẽ nhận chung promise.
 * - Gọi lại với priority cao hơn sẽ đẩy task lên trước (người dùng đang chờ nghe câu đó).
 */
class TtsQueue {
  private tasks: Task[] = [];
  private running: Task | null = null;

  enqueue(key: string, run: () => Promise<void>, priority: number = PRIORITY.prefetch): Promise<void> {
    if (this.running?.key === key) return this.running.promise;
    const existing = this.tasks.find((t) => t.key === key);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      this.sort();
      return existing.promise;
    }
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
    promise.catch(() => {}); // tránh unhandled rejection khi task prefetch lỗi mà không ai chờ
    this.tasks.push({ key, priority, run, promise, resolve, reject });
    this.sort();
    void this.next();
    return promise;
  }

  /** Bỏ các task prefetch chưa chạy (vd. người dùng chuyển sang chương khác). */
  cancel(keys: Iterable<string>) {
    const set = new Set(keys);
    this.tasks = this.tasks.filter((t) => {
      if (!set.has(t.key) || t.priority > PRIORITY.prefetch) return true;
      t.reject(new Error("cancelled"));
      return false;
    });
  }

  get size() {
    return this.tasks.length + (this.running ? 1 : 0);
  }

  private sort() {
    // Sort ổn định: cùng priority thì giữ thứ tự thêm vào (đọc đúng thứ tự câu).
    this.tasks.sort((a, b) => b.priority - a.priority);
  }

  private async next() {
    if (this.running) return;
    const task = this.tasks.shift();
    if (!task) return;
    this.running = task;
    try {
      await task.run();
      task.resolve();
    } catch (err) {
      task.reject(err);
    } finally {
      this.running = null;
      void this.next();
    }
  }
}

export const ttsQueue = new TtsQueue();
