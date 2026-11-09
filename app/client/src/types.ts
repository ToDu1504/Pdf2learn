export type User = { id: number; email: string; full_name: string };

export type DocumentStatus = "queued" | "processing" | "done" | "failed";
export type ChapterStatus = "pending" | "done" | "failed";

export type DocumentItem = {
  id: number;
  title: string;
  file_size: number;
  page_count: number | null;
  status: DocumentStatus;
  current_step: string | null;
  progress: number;
  error_message: string | null;
  created_at: string;
  chapter_count?: number;
  completed_count?: number;
};

export type ChapterItem = {
  id: number;
  order_index: number;
  title: string;
  /** Tên mục gốc trong sách (để đối chiếu). */
  source_title?: string | null;
  start_page: number;
  end_page: number;
  status: ChapterStatus;
  analyzing?: boolean;
  section_id?: number | null;
  description?: string | null;
  importance?: "core" | "optional";
  est_minutes?: number | null;
  completed_at?: string | null;
};

/** Phần ôn tập của sách cho 1 chặng (server: services/bookReview.service.ts). */
export type BookReview = {
  questions: number;
  /** Số câu nhiều đáp án ("Choose two") trong số câu hỏi. */
  multi_skipped: number;
  question_pages: { from: number; to: number } | null;
  essentials: { text: string; page: number }[];
  key_terms: string[];
  labs: { title: string; from: number; to: number }[];
};
export type RoadmapSection = { id: number; order_index: number; title: string; source_title?: string | null; description: string | null; review?: BookReview | null };

/** Đối chiếu roadmap với sách: trang được học và các đoạn bị bỏ qua (kèm tên mục trong sách). */
export type RoadmapReport = {
  page_count: number;
  covered: number;
  skipped: { from: number; to: number; titles: string[] }[];
  source: "bookmark" | "toc" | "fixed";
  ai: boolean;
};

export type DocumentDetail = DocumentItem & { chapters: ChapterItem[]; sections: RoadmapSection[]; roadmap_report?: RoadmapReport | null };

/** quote: câu trích nguyên văn từ sách; verified: máy đã tìm thấy câu trích trong text trang. */
export type KeyPoint = { point: string; page: number; page_end?: number; quote?: string; verified?: boolean };
export type KeyTerm = { term: string; definition: string; page: number; page_end?: number; quote?: string; verified?: boolean };
export type Evidence = { k: number; page: number; quote: string; verified: boolean };
export type Subtopic = { title: string; from: number; to: number };
/** Kết quả đối chiếu bài với sách (server: services/ai/grounding.ts). */
export type Grounding = {
  mode: "text" | "file";
  lesson: { verified: number; total: number };
  points: { kept: number; dropped: number };
  terms: { kept: number; dropped: number };
  questions: { kept: number; dropped: number };
  missing: Subtopic[];
  subtopics: number;
};
export type Summary = {
  id: number;
  overview: string;
  key_points: KeyPoint[];
  key_terms: KeyTerm[];
  mindmap_mermaid: string | null;
  lesson_md: string | null;
  evidence?: Evidence[] | null;
  grounding?: Grounding | null;
};

export type QuestionType = "mcq" | "true_false" | "short_answer";
export type Difficulty = "easy" | "medium" | "hard";

export type Question = {
  id: number;
  chapter_id: number;
  type: QuestionType;
  difficulty: Difficulty;
  content: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  source_page: number;
  topic: string;
  source_quote?: string | null;
  verified?: boolean | null;
  /** "book": câu hỏi in trong sách, đáp án theo sách. */
  origin?: "ai" | "book";
};
export type PublicQuestion = Omit<Question, "correct_answer" | "explanation"> & { multi?: boolean };

export type ChapterDetail = ChapterItem & {
  document: { id: number; title: string; page_count: number | null };
  summary: Summary | null;
  questions: Question[];
  analyzing: boolean;
  analyze_error: string | null;
};

export type QuizMode = "chapter" | "mixed" | "weak" | "exam";
export type QuizAttempt = {
  id: number;
  document_id: number;
  mode: QuizMode;
  total_questions: number;
  correct_count: number;
  score: number | null;
  started_at: string;
  finished_at: string | null;
};
export type QuizSession = { attempt: QuizAttempt; time_limit_sec: number | null; questions: PublicQuestion[] };

export type AttemptAnswer = {
  id: number;
  question_id: number;
  user_answer: string | null;
  is_correct: boolean | null;
  ai_score: number | null;
  ai_feedback: string | null;
  question: Question & { chapter: { id: number; title: string } };
};
export type QuizResult = QuizAttempt & { answers: AttemptAnswer[] };

export type Flashcard = {
  id: number;
  chapter_id: number;
  front: string;
  back: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  next_review_at: string;
  chapter?: { id: number; title: string; document_id: number };
};

export type Settings = {
  theme: "light" | "dark" | "system";
  /** Tự soạn trước mọi bài giảng ở nền. */
  auto_prepare: boolean;
  /** Tự dịch trước toàn bộ PDF ở nền. */
  auto_translate: boolean;
};

export type TutorQuizItem = {
  id: number;
  type: string;
  content: string;
  options: string[] | null;
  correct_answer: string;
  explanation: string;
  source_page: number;
};
export type TutorQuiz = { chapterTitle: string; questions: TutorQuizItem[] };
export type TutorMessage = {
  id: number;
  role: "user" | "model" | "tool";
  content: string;
  tool_calls: { name: string; args: unknown; quiz?: TutorQuiz }[] | null;
  created_at: string;
};
export type TutorSession = { id: number; title: string; document_id: number; created_at: string };

