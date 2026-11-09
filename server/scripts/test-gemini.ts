// Giai đoạn 0: gửi 1 PDF thật cho Gemini, thử tóm tắt bằng structured output.
// Chạy: npm run test:gemini -- path/to/file.pdf
import { readFile } from "node:fs/promises";
import { ai, MODEL } from "../src/services/ai/gemini.client.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: npm run test:gemini -- <file.pdf>");
if (!MODEL) throw new Error("Set GEMINI_MODEL in server/.env");

const data = (await readFile(file)).toString("base64");
const res = await ai.models.generateContent({
  model: MODEL,
  contents: [{
    role: "user",
    parts: [
      { inlineData: { data, mimeType: "application/pdf" } },
      { text: "Dựa DUY NHẤT vào tài liệu đính kèm, tóm tắt bằng tiếng Việt: overview (3–5 câu), key_points (5–10 ý, mỗi ý kèm page)." },
    ],
  }],
  config: {
    responseMimeType: "application/json",
    responseSchema: {
      type: "object",
      properties: {
        overview: { type: "string" },
        key_points: { type: "array", items: { type: "object", properties: { point: { type: "string" }, page: { type: "integer" } }, required: ["point", "page"] } },
      },
      required: ["overview", "key_points"],
    },
    temperature: 0.3,
  },
});
console.log(JSON.stringify(JSON.parse(res.text ?? "{}"), null, 2));
console.log("usage:", res.usageMetadata);
