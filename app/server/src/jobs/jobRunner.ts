type Job = { key: string; run: () => Promise<void> };

/** Hàng đợi trong process, chạy lần lượt từng job (concurrency = 1, an toàn với rate limit). */
class JobRunner {
  private queue: Job[] = [];
  private current: string | null = null;

  /** Bỏ qua nếu job cùng key đang chờ hoặc đang chạy (vd. bấm retry 2 lần). */
  add(key: string, run: () => Promise<void>) {
    if (this.current === key || this.queue.some((j) => j.key === key)) return;
    this.queue.push({ key, run });
    void this.next();
  }

  private async next() {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job.key;
    try {
      await job.run();
    } catch (err) {
      console.error(`[job ${job.key}] failed:`, err);
    } finally {
      this.current = null;
      void this.next();
    }
  }
}

export const jobRunner = new JobRunner();
