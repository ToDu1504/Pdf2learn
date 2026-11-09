// Dấu chấm trong các cụm này không phải kết thúc câu.
const NO_BREAK = ["v.v.", "TS.", "ThS.", "PGS.", "GS.", "Tr.", "tr.", "Th.S.", "e.g.", "i.e.", "vs.", "Mr.", "Dr."];
const PLACEHOLDER = "\u0000";

/**
 * Tách câu để đọc từng câu. Không tách ở số thập phân (3.14), viết tắt (TS., v.v.),
 * hay dấu ":" (thường đi trước định nghĩa). Câu dài cắt tại dấu phẩy gần nhất.
 */
export function splitSentences(text: string, maxLen = 200, minLen = 15): string[] {
  let t = text;
  for (const abbr of NO_BREAK) t = t.split(abbr).join(abbr.replace(/\./g, PLACEHOLDER));
  t = t.replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER}$2`);

  const raw = t.match(/[^.!?;\n]+(?:[.!?;]+|$)/g) ?? [];
  const out: string[] = [];
  for (let s of raw.map((x) => x.replace(new RegExp(PLACEHOLDER, "g"), ".").trim()).filter(Boolean)) {
    while (s.length > maxLen) {
      // Giữ cả dấu phẩy trong đoạn đầu nên tìm tới maxLen - 1.
      const cut = s.lastIndexOf(",", maxLen - 1);
      const space = s.lastIndexOf(" ", maxLen);
      const min = Math.min(50, maxLen / 2);
      const i = cut > min ? cut + 1 : space > min ? space : maxLen;
      out.push(s.slice(0, i).trim());
      s = s.slice(i).trim();
    }
    if (!s) continue;
    const last = out[out.length - 1];
    if (s.length < minLen && last && last.length + 1 + s.length <= maxLen) out[out.length - 1] = `${last} ${s}`;
    else out.push(s);
  }
  return out;
}
