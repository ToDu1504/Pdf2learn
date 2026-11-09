import { Type } from "@google/genai";
import { z } from "zod";

/* Mỗi output AI có 2 schema: JSON schema gửi cho Gemini (responseSchema)
   và Zod để validate lại phía server. */

export const tocSchema = {
  type: Type.OBJECT,
  properties: {
    page_offset: { type: Type.INTEGER, description: "Số trang PDF trừ số trang in trên giấy" },
    chapters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          start_page: { type: Type.INTEGER },
        },
        required: ["title", "start_page"],
      },
    },
  },
  required: ["page_offset", "chapters"],
};
export const TocZod = z.object({
  page_offset: z.number().int(),
  chapters: z.array(z.object({ title: z.string().min(1), start_page: z.number().int() })),
});

export const summarySchema = {
  type: Type.OBJECT,
  properties: {
    overview: { type: Type.STRING },
    key_points: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { point: { type: Type.STRING }, page: { type: Type.INTEGER }, page_end: { type: Type.INTEGER, description: "Trang kết thúc nếu ý trải dài nhiều trang; bỏ trống nếu chỉ 1 trang" } },
        required: ["point", "page"],
      },
    },
    key_terms: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { term: { type: Type.STRING }, definition: { type: Type.STRING }, page: { type: Type.INTEGER }, page_end: { type: Type.INTEGER, description: "Trang kết thúc nếu ý trải dài nhiều trang; bỏ trống nếu chỉ 1 trang" } },
        required: ["term", "definition", "page"],
      },
    },
  },
  required: ["overview", "key_points", "key_terms"],
};
export const SummaryZod = z.object({
  overview: z.string().min(1),
  key_points: z.array(z.object({ point: z.string(), page: z.number().int(), page_end: z.number().int().optional() })),
  key_terms: z.array(z.object({ term: z.string(), definition: z.string(), page: z.number().int(), page_end: z.number().int().optional() })),
});
export type SummaryData = z.infer<typeof SummaryZod>;

export const quizSchema = {
  type: Type.OBJECT,
  properties: {
    questions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING, enum: ["mcq", "true_false", "short_answer"] },
          difficulty: { type: Type.STRING, enum: ["easy", "medium", "hard"] },
          content: { type: Type.STRING },
          options: { type: Type.ARRAY, items: { type: Type.STRING } },
          correct_answer: { type: Type.STRING },
          explanation: { type: Type.STRING },
          source_page: { type: Type.INTEGER },
          topic: { type: Type.STRING },
        },
        required: ["type", "difficulty", "content", "correct_answer", "explanation", "source_page", "topic"],
      },
    },
  },
  required: ["questions"],
};

const QuestionZod = z
  .object({
    type: z.enum(["mcq", "true_false", "short_answer"]),
    difficulty: z.enum(["easy", "medium", "hard"]),
    content: z.string().min(1),
    options: z.array(z.string()).optional(),
    correct_answer: z.string().min(1),
    explanation: z.string(),
    source_page: z.number().int(),
    topic: z.string().min(1),
  })
  .transform((q) => {
    if (q.type === "true_false") return { ...q, options: ["Đúng", "Sai"] };
    if (q.type === "short_answer") return { ...q, options: undefined };
    return q;
  })
  // Đáp án đúng phải nằm trong danh sách lựa chọn, nếu không câu hỏi vô dụng.
  .refine((q) => q.type === "short_answer" || (q.options?.includes(q.correct_answer) ?? false), {
    message: "correct_answer không nằm trong options",
  })
  .refine((q) => q.type !== "mcq" || q.options?.length === 4, { message: "MCQ cần đúng 4 lựa chọn" });

/** Bỏ các câu hỏi lỗi thay vì làm hỏng cả lô. */
export const QuizZod = z.object({ questions: z.array(z.unknown()) }).transform(({ questions }) =>
  questions.flatMap((q) => {
    const r = QuestionZod.safeParse(q);
    return r.success ? [r.data] : [];
  }),
);
export type GeneratedQuestion = z.infer<typeof QuestionZod>;

/** Tóm tắt + câu hỏi trong 1 lượt gọi (pipeline): tiết kiệm 1/2 hạn mức request. */
export const analysisSchema = {
  type: Type.OBJECT,
  properties: { lesson: { type: Type.STRING }, ...summarySchema.properties, questions: quizSchema.properties.questions },
  required: ["lesson", ...summarySchema.required, "questions"],
};
export const AnalysisZod = z
  .object({ questions: z.array(z.unknown()).default([]) })
  .passthrough()
  .transform((raw) => ({
    summary: SummaryZod.parse(raw),
    lesson: typeof raw.lesson === "string" && raw.lesson.trim() ? raw.lesson.trim() : null,
    questions: QuizZod.parse({ questions: raw.questions }),
  }));

/** Nhiều chương trong 1 lượt gọi: mỗi phần tử là kết quả của 1 chương, khớp theo chapter_id. */
export const batchAnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    chapters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { chapter_id: { type: Type.INTEGER }, ...analysisSchema.properties },
        required: ["chapter_id", ...analysisSchema.required],
      },
    },
  },
  required: ["chapters"],
};
/** Chương nào parse lỗi thì bỏ riêng chương đó (sẽ được xử lý lại một mình). */
export const BatchAnalysisZod = z.object({ chapters: z.array(z.unknown()) }).transform(({ chapters }) =>
  chapters.flatMap((c) => {
    const id = z.object({ chapter_id: z.coerce.number().int() }).safeParse(c);
    const body = AnalysisZod.safeParse(c);
    return id.success && body.success ? [{ chapter_id: id.data.chapter_id, ...body.data }] : [];
  }),
);

export const gradeSchema = {
  type: Type.OBJECT,
  properties: {
    score: { type: Type.NUMBER },
    feedback: { type: Type.STRING },
    missing_points: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["score", "feedback", "missing_points"],
};
export const GradeZod = z.object({
  score: z.number().min(0).max(10),
  feedback: z.string(),
  missing_points: z.array(z.string()),
});

export const mindmapSchema = {
  type: Type.OBJECT,
  properties: { mermaid: { type: Type.STRING } },
  required: ["mermaid"],
};
export const MindmapZod = z.object({
  mermaid: z
    .string()
    .transform((s) => s.replace(/^```(?:mermaid)?\s*/i, "").replace(/```\s*$/, "").trim())
    .refine((s) => s.startsWith("mindmap"), { message: "Không phải mermaid mindmap" }),
});

export const excerptSchema = {
  type: Type.OBJECT,
  properties: {
    found: { type: Type.BOOLEAN },
    excerpts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { text: { type: Type.STRING }, page: { type: Type.INTEGER } },
        required: ["text", "page"],
      },
    },
  },
  required: ["found", "excerpts"],
};
export const ExcerptZod = z.object({
  found: z.boolean(),
  excerpts: z.array(z.object({ text: z.string(), page: z.number().int() })),
});
