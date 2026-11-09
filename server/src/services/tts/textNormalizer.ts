// Viết tắt hay gặp trong giáo trình. Mở rộng dần theo tài liệu thực tế.
const ABBR: Record<string, string> = {
  VD: "ví dụ",
  CSDL: "cơ sở dữ liệu",
  HĐH: "hệ điều hành",
  CNTT: "công nghệ thông tin",
  KTMT: "kiến trúc máy tính",
  "v.v.": "vân vân",
  "v.v": "vân vân",
  "tr.": "trang",
  TS: "tiến sĩ",
  ThS: "thạc sĩ",
  PGS: "phó giáo sư",
  GS: "giáo sư",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Ranh giới từ theo Unicode: \b của JS không hiểu chữ có dấu tiếng Việt.
const ABBR_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Object.keys(ABBR).sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}\\p{N}])`,
  "gu",
);

export function normalizeForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " Đoạn mã, xem trên màn hình. ")
    .replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, " công thức trên màn hình ")
    .replace(/\((?:tr|trang)\.?\s*\d+(?:\s*[-–]\s*\d+)?\)/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[#*_>|~]/g, " ")
    .replace(/&/g, " và ")
    .replace(/(\d)\s*%/g, "$1 phần trăm")
    .replace(ABBR_RE, (m) => ABBR[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ ([.,;:!?])/g, "$1")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
