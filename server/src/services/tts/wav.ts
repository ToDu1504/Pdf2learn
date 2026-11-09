export type WavInfo = {
  fmt: Buffer; // nội dung chunk "fmt " (không gồm header 8 byte)
  data: Buffer;
  byteRate: number;
  durationMs: number;
};

/** Đọc WAV PCM: tìm chunk fmt và data. Chịu được data size = 0xFFFFFFFF (WAV dạng stream). */
export function parseWav(buf: Buffer): WavInfo {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("Không phải file WAV");
  let fmt: Buffer | null = null;
  let data: Buffer | null = null;
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const start = off + 8;
    if (start + size > buf.length) size = buf.length - start;
    if (id === "fmt ") fmt = buf.subarray(start, start + size);
    else if (id === "data") data = buf.subarray(start, start + size);
    off = start + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("WAV thiếu chunk fmt/data");
  const byteRate = fmt.readUInt32LE(8);
  return { fmt, data, byteRate, durationMs: Math.round((data.length / byteRate) * 1000) };
}

/** Ghép nhiều WAV cùng định dạng thành 1 file. */
export function concatWav(files: Buffer[]): Buffer {
  const parts = files.map(parseWav);
  const fmt = parts[0].fmt;
  const dataLen = parts.reduce((n, p) => n + p.data.length, 0);
  const header = Buffer.alloc(12 + 8 + fmt.length + 8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + 8 + fmt.length + 8 + dataLen, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(fmt.length, 16);
  fmt.copy(header, 20);
  header.write("data", 20 + fmt.length, "ascii");
  header.writeUInt32LE(dataLen, 24 + fmt.length);
  return Buffer.concat([header, ...parts.map((p) => p.data)]);
}
