const RETRYABLE = new Set([429, 500, 503]);

type ApiLikeError = { status?: number; message?: string };

/** 429 do hết hạn mức THEO NGÀY: thử lại vô ích, phải chuyển model hoặc chờ hôm sau. */
export function isDailyQuotaError(err: unknown) {
  const e = err as ApiLikeError;
  return e?.status === 429 && /per ?day|PerDay|daily/i.test(e.message ?? "");
}

/**
 * Lỗi mạng / model treo (không có mã HTTP): "fetch failed", hết thời gian chờ, mất kết nối.
 * Coi là lỗi tạm thời của model đó → chuyển model dự phòng thay vì dừng hẳn.
 */
export function isNetworkError(err: unknown) {
  const e = err as ApiLikeError & { name?: string; code?: string; cause?: { code?: string; message?: string } };
  if (e?.status) return false;
  const text = `${e?.name ?? ""} ${e?.code ?? ""} ${e?.message ?? ""} ${e?.cause?.code ?? ""} ${e?.cause?.message ?? ""}`;
  return /fetch failed|terminated|timed? ?out|timeout|abort|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(text);
}

/** Gemini gợi ý thời gian chờ ("Please retry in 31.2s" / "retryDelay":"31s"). */
function suggestedDelayMs(err: unknown) {
  const m = /retry in ([\d.]+)s|"retryDelay":\s*"(\d+)s"/i.exec((err as ApiLikeError)?.message ?? "");
  return m ? Math.ceil(Number(m[1] ?? m[2]) * 1000) : null;
}

export async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const status = (err as ApiLikeError)?.status;
    if (!status || !RETRYABLE.has(status) || retries === 0 || isDailyQuotaError(err)) throw err;
    const wait = Math.min(60_000, Math.max(delay, suggestedDelayMs(err) ?? 0));
    await new Promise((r) => setTimeout(r, wait));
    return withRetry(fn, retries - 1, delay * 2);
  }
}
