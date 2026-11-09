import { env } from "../../config/env.js";

const TTS_URL = env.TTS_URL.replace(/\/$/, "");

export async function synthesize(text: string, voice: string): Promise<Buffer> {
  const res = await fetch(`${TTS_URL}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer local" },
    body: JSON.stringify({ model: env.TTS_MODEL, voice, input: text, response_format: "wav" }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const err = new Error(`TTS ${res.status}: ${await res.text().catch(() => "")}`) as Error & { status: number };
    err.status = res.status; // 429 → withRetry sẽ thử lại
    throw err;
  }
  return Buffer.from(await res.arrayBuffer());
}

export type Voice = { id: string; name: string; [k: string]: unknown };

export async function listVoices(): Promise<Voice[]> {
  const res = await fetch(`${TTS_URL}/voices`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`TTS voices ${res.status}`);
  const body = (await res.json()) as unknown;
  // Chấp nhận nhiều dạng: [..], {data: [..]}, {voices: [..]}; phần tử là string hoặc object.
  const list = Array.isArray(body)
    ? body
    : ((body as { data?: unknown[]; voices?: unknown[] }).data ?? (body as { voices?: unknown[] }).voices ?? []);
  return list.map((v) =>
    typeof v === "string"
      ? { id: v, name: v }
      : { ...(v as object), id: String((v as Voice).id ?? (v as Voice).name), name: String((v as Voice).name ?? (v as Voice).id) },
  );
}

let cache: { at: number; online: boolean } | null = null;

export async function isTtsOnline() {
  if (cache && Date.now() - cache.at < 10_000) return cache.online;
  let online = false;
  try {
    online = (await fetch(TTS_URL.replace(/\/v1$/, "/health"), { signal: AbortSignal.timeout(2000) })).ok;
  } catch {
    online = false;
  }
  cache = { at: Date.now(), online };
  return online;
}
