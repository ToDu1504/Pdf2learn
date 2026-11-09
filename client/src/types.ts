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

export type RoadmapSection = { id: number; order_index: number; title: string; description: string | null };

export type DocumentDetail = DocumentItem & { chapters: ChapterItem[]; sections: RoadmapSection[] };

export type KeyPoint = { point: string; page: number; page_end?: number };
export type KeyTerm = { term: string; definition: string; page: number; page_end?: number };
export type Summary = {
  id: number;
  overview: string;
  key_points: KeyPoint[];
  key_terms: KeyTerm[];
  mindmap_mermaid: string | null;
  lesson_md: string | null;
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
};
export type PublicQuestion = Omit<Question, "correct_answer" | "explanation">;

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
  tts_voice: string;
  tts_rate: number;
  auto_read_tutor: boolean;
  theme: "light" | "dark" | "system";
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

export type AudioSegment = {
  text: string;
  hash: string;
  audioUrl: string;
  status: "pending" | "done" | "failed";
  durationMs: number | null;
};
