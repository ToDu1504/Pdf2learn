import {
  DataTypes,
  Model,
  type CreationOptional,
  type ForeignKey,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "../config/db.js";

const pk = { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true };
const int = (allowNull = false) => ({ type: DataTypes.INTEGER, allowNull });
const str = (allowNull = false) => ({ type: DataTypes.STRING, allowNull });
const text = (allowNull = false) => ({ type: DataTypes.TEXT, allowNull });
/** MariaDB lưu JSON dạng LONGTEXT nên mysql2 trả về string: parse lại trong getter để chạy được cả MySQL 8 lẫn MariaDB. */
const json = (field: string, allowNull = false) => ({
  type: DataTypes.JSON,
  allowNull,
  get(this: Model) {
    const v = this.getDataValue(field as never) as unknown;
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  },
});

/* ---------------- users ---------------- */

export class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
  declare id: CreationOptional<number>;
  declare email: string;
  declare password_hash: string;
  declare full_name: string;
}
User.init(
  { id: pk, email: { ...str(), unique: true }, password_hash: str(), full_name: str() },
  { sequelize, tableName: "users" },
);

export type Theme = "light" | "dark" | "system";
export class UserSettings extends Model<InferAttributes<UserSettings>, InferCreationAttributes<UserSettings>> {
  declare user_id: number;
  declare tts_voice: CreationOptional<string>;
  declare tts_rate: CreationOptional<number>;
  declare auto_read_tutor: CreationOptional<boolean>;
  declare theme: CreationOptional<Theme>;
}
UserSettings.init(
  {
    user_id: { type: DataTypes.INTEGER, primaryKey: true },
    tts_voice: { ...str(), defaultValue: "Hải Đăng" },
    tts_rate: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1 },
    auto_read_tutor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    theme: { type: DataTypes.ENUM("light", "dark", "system"), allowNull: false, defaultValue: "system" },
  },
  { sequelize, tableName: "user_settings" },
);

/* ---------------- documents & chapters ---------------- */

export type DocumentStatus = "queued" | "processing" | "done" | "failed";
export class Document extends Model<InferAttributes<Document>, InferCreationAttributes<Document>> {
  declare id: CreationOptional<number>;
  declare user_id: ForeignKey<User["id"]>;
  declare title: string;
  declare file_path: string;
  declare file_size: number;
  declare file_hash: CreationOptional<string | null>;
  declare page_count: CreationOptional<number | null>;
  declare status: CreationOptional<DocumentStatus>;
  declare current_step: CreationOptional<string | null>;
  declare progress: CreationOptional<number>;
  declare error_message: CreationOptional<string | null>;
  declare created_at: CreationOptional<Date>;
}
Document.init(
  {
    id: pk,
    title: str(),
    file_path: str(),
    file_size: int(),
    file_hash: { type: DataTypes.CHAR(64), allowNull: true },
    page_count: int(true),
    status: { type: DataTypes.ENUM("queued", "processing", "done", "failed"), defaultValue: "queued" },
    current_step: str(true),
    progress: { type: DataTypes.TINYINT, defaultValue: 0 },
    error_message: text(true),
    created_at: DataTypes.DATE,
  },
  { sequelize, tableName: "documents" },
);

export type ChapterStatus = "pending" | "done" | "failed";
export class Chapter extends Model<InferAttributes<Chapter>, InferCreationAttributes<Chapter>> {
  declare id: CreationOptional<number>;
  declare document_id: ForeignKey<Document["id"]>;
  declare order_index: number;
  declare title: string;
  declare start_page: number;
  declare end_page: number;
  declare gemini_file_uri: CreationOptional<string | null>;
  declare gemini_file_expires_at: CreationOptional<Date | null>;
  declare status: CreationOptional<ChapterStatus>;
  declare section_id: CreationOptional<number | null>;
  declare description: CreationOptional<string | null>;
  declare importance: CreationOptional<"core" | "optional">;
  declare est_minutes: CreationOptional<number | null>;
  declare completed_at: CreationOptional<Date | null>;
}
Chapter.init(
  {
    id: pk,
    order_index: int(),
    title: str(),
    start_page: int(),
    end_page: int(),
    gemini_file_uri: str(true),
    gemini_file_expires_at: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.ENUM("pending", "done", "failed"), defaultValue: "pending" },
    section_id: int(true),
    description: text(true),
    importance: { type: DataTypes.ENUM("core", "optional"), defaultValue: "core" },
    est_minutes: int(true),
    completed_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: "chapters" },
);

export type KeyPoint = { point: string; page: number; page_end?: number };
export type KeyTerm = { term: string; definition: string; page: number; page_end?: number };
export class Summary extends Model<InferAttributes<Summary>, InferCreationAttributes<Summary>> {
  declare id: CreationOptional<number>;
  declare chapter_id: number;
  declare overview: string;
  declare key_points: KeyPoint[];
  declare key_terms: KeyTerm[];
  declare mindmap_mermaid: CreationOptional<string | null>;
  declare lesson_md: CreationOptional<string | null>;
}
Summary.init(
  { id: pk, chapter_id: { ...int(), unique: true }, overview: text(), key_points: json("key_points"), key_terms: json("key_terms"), mindmap_mermaid: text(true), lesson_md: { type: DataTypes.TEXT("medium"), allowNull: true } },
  { sequelize, tableName: "summaries" },
);

/* ---------------- questions & quizzes ---------------- */

export type QuestionType = "mcq" | "true_false" | "short_answer";
export type Difficulty = "easy" | "medium" | "hard";
export class Question extends Model<InferAttributes<Question>, InferCreationAttributes<Question>> {
  declare id: CreationOptional<number>;
  declare chapter_id: number;
  declare type: QuestionType;
  declare difficulty: Difficulty;
  declare content: string;
  declare options: string[] | null;
  declare correct_answer: string;
  declare explanation: string;
  declare source_page: number;
  declare topic: string;
}
Question.init(
  {
    id: pk,
    chapter_id: int(),
    type: { type: DataTypes.ENUM("mcq", "true_false", "short_answer"), allowNull: false },
    difficulty: { type: DataTypes.ENUM("easy", "medium", "hard"), allowNull: false },
    content: text(),
    options: json("options", true),
    correct_answer: text(),
    explanation: text(),
    source_page: int(),
    topic: str(),
  },
  { sequelize, tableName: "questions" },
);

export type QuizMode = "chapter" | "mixed" | "weak" | "exam";
export class QuizAttempt extends Model<InferAttributes<QuizAttempt>, InferCreationAttributes<QuizAttempt>> {
  declare id: CreationOptional<number>;
  declare user_id: number;
  declare document_id: number;
  declare mode: QuizMode;
  declare total_questions: number;
  declare correct_count: CreationOptional<number>;
  declare score: CreationOptional<number | null>;
  declare started_at: CreationOptional<Date>;
  declare finished_at: CreationOptional<Date | null>;
}
QuizAttempt.init(
  {
    id: pk,
    user_id: int(),
    document_id: int(),
    mode: { type: DataTypes.ENUM("chapter", "mixed", "weak", "exam"), allowNull: false },
    total_questions: int(),
    correct_count: { ...int(), defaultValue: 0 },
    // DECIMAL đọc ra là string trong mysql2 → ép về number.
    score: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      get() {
        const v = this.getDataValue("score");
        return v == null ? null : Number(v);
      },
    },
    started_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    finished_at: { type: DataTypes.DATE, allowNull: true },
  },
  { sequelize, tableName: "quiz_attempts" },
);

export class AttemptAnswer extends Model<InferAttributes<AttemptAnswer>, InferCreationAttributes<AttemptAnswer>> {
  declare id: CreationOptional<number>;
  declare attempt_id: number;
  declare question_id: number;
  declare user_answer: CreationOptional<string | null>;
  declare is_correct: CreationOptional<boolean | null>;
  declare ai_score: CreationOptional<number | null>;
  declare ai_feedback: CreationOptional<string | null>;
  declare question?: Question;
}
AttemptAnswer.init(
  {
    id: pk,
    attempt_id: int(),
    question_id: int(),
    user_answer: text(true),
    is_correct: { type: DataTypes.BOOLEAN, allowNull: true },
    ai_score: {
      type: DataTypes.DECIMAL(4, 2),
      allowNull: true,
      get() {
        const v = this.getDataValue("ai_score");
        return v == null ? null : Number(v);
      },
    },
    ai_feedback: text(true),
  },
  { sequelize, tableName: "attempt_answers" },
);

/* ---------------- flashcards ---------------- */

export class Flashcard extends Model<InferAttributes<Flashcard>, InferCreationAttributes<Flashcard>> {
  declare id: CreationOptional<number>;
  declare chapter_id: number;
  declare user_id: number;
  declare front: string;
  declare back: string;
  declare ease_factor: CreationOptional<number>;
  declare interval_days: CreationOptional<number>;
  declare repetitions: CreationOptional<number>;
  declare next_review_at: CreationOptional<Date>;
}
Flashcard.init(
  {
    id: pk,
    chapter_id: int(),
    user_id: int(),
    front: text(),
    back: text(),
    ease_factor: { type: DataTypes.FLOAT, defaultValue: 2.5 },
    interval_days: { ...int(), defaultValue: 0 },
    repetitions: { ...int(), defaultValue: 0 },
    next_review_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: "flashcards" },
);

/* ---------------- AI usage ---------------- */

export class AiUsageLog extends Model<InferAttributes<AiUsageLog>, InferCreationAttributes<AiUsageLog>> {
  declare id: CreationOptional<number>;
  declare user_id: number;
  declare feature: string;
  declare input_tokens: number;
  declare output_tokens: number;
  declare created_at: CreationOptional<Date>;
}
AiUsageLog.init(
  { id: pk, user_id: int(), feature: str(), input_tokens: int(), output_tokens: int(), created_at: DataTypes.DATE },
  { sequelize, tableName: "ai_usage_logs" },
);

/* ---------------- tutor ---------------- */

export class TutorSession extends Model<InferAttributes<TutorSession>, InferCreationAttributes<TutorSession>> {
  declare id: CreationOptional<number>;
  declare user_id: number;
  declare document_id: number;
  declare title: string;
  declare created_at: CreationOptional<Date>;
}
TutorSession.init(
  { id: pk, user_id: int(), document_id: int(), title: str(), created_at: DataTypes.DATE },
  { sequelize, tableName: "tutor_sessions" },
);

export type ToolCallLog = { name: string; args: unknown; quiz?: unknown };
export class TutorMessage extends Model<InferAttributes<TutorMessage>, InferCreationAttributes<TutorMessage>> {
  declare id: CreationOptional<number>;
  declare session_id: number;
  declare role: "user" | "model" | "tool";
  declare content: string;
  declare tool_calls: CreationOptional<ToolCallLog[] | null>;
  declare created_at: CreationOptional<Date>;
}
TutorMessage.init(
  {
    id: pk,
    session_id: int(),
    role: { type: DataTypes.ENUM("user", "model", "tool"), allowNull: false },
    content: { type: DataTypes.TEXT("medium"), allowNull: false },
    tool_calls: json("tool_calls", true),
    created_at: DataTypes.DATE,
  },
  { sequelize, tableName: "tutor_messages" },
);

/* ---------------- TTS ---------------- */

export class TtsAudio extends Model<InferAttributes<TtsAudio>, InferCreationAttributes<TtsAudio>> {
  declare id: CreationOptional<number>;
  declare hash: string;
  declare voice: string;
  declare text: string;
  declare file_path: CreationOptional<string | null>;
  declare duration_ms: CreationOptional<number | null>;
  declare size_bytes: CreationOptional<number | null>;
  declare status: CreationOptional<"pending" | "done" | "failed">;
  declare last_used_at: CreationOptional<Date>;
}
TtsAudio.init(
  {
    id: pk,
    hash: { type: DataTypes.CHAR(64), allowNull: false, unique: true },
    voice: str(),
    text: text(),
    file_path: str(true),
    duration_ms: int(true),
    size_bytes: int(true),
    status: { type: DataTypes.ENUM("pending", "done", "failed"), defaultValue: "pending" },
    last_used_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  { sequelize, tableName: "tts_audios" },
);

export class ChapterAudioSegment extends Model<
  InferAttributes<ChapterAudioSegment>,
  InferCreationAttributes<ChapterAudioSegment>
> {
  declare id: CreationOptional<number>;
  declare chapter_id: number;
  declare voice: string;
  declare order_index: number;
  declare display_text: string;
  declare tts_audio_id: number;
  declare audio?: TtsAudio;
}
ChapterAudioSegment.init(
  { id: pk, chapter_id: int(), voice: str(), order_index: int(), display_text: text(), tts_audio_id: int() },
  { sequelize, tableName: "chapter_audio_segments" },
);

/* ---------------- text từng trang (trích bằng pdfjs) ---------------- */

export class DocumentPage extends Model<InferAttributes<DocumentPage>, InferCreationAttributes<DocumentPage>> {
  declare id: CreationOptional<number>;
  declare document_id: number;
  declare page: number;
  declare text: string;
}
DocumentPage.init(
  { id: pk, document_id: int(), page: int(), text: { type: DataTypes.TEXT("medium"), allowNull: false } },
  { sequelize, tableName: "document_pages" },
);

/* ---------------- bản dịch trang ---------------- */

export class PageTranslation extends Model<InferAttributes<PageTranslation>, InferCreationAttributes<PageTranslation>> {
  declare id: CreationOptional<number>;
  declare document_id: number;
  declare page: number;
  declare lang: string;
  declare text: string;
}
PageTranslation.init(
  { id: pk, document_id: int(), page: int(), lang: { type: DataTypes.STRING(8), allowNull: false }, text: { type: DataTypes.TEXT("medium"), allowNull: false } },
  { sequelize, tableName: "page_translations" },
);

/* ---------------- roadmap ---------------- */

export class RoadmapSection extends Model<InferAttributes<RoadmapSection>, InferCreationAttributes<RoadmapSection>> {
  declare id: CreationOptional<number>;
  declare document_id: number;
  declare order_index: number;
  declare title: string;
  declare description: CreationOptional<string | null>;
}
RoadmapSection.init(
  { id: pk, document_id: int(), order_index: int(), title: str(), description: text(true) },
  { sequelize, tableName: "roadmap_sections" },
);

/* ---------------- associations ---------------- */

User.hasMany(Document, { foreignKey: "user_id" });
Document.belongsTo(User, { foreignKey: "user_id" });
Document.hasMany(Chapter, { foreignKey: "document_id", as: "chapters" });
Chapter.belongsTo(Document, { foreignKey: "document_id" });
Chapter.hasOne(Summary, { foreignKey: "chapter_id", as: "summary" });
Chapter.hasMany(Question, { foreignKey: "chapter_id" });
Question.belongsTo(Chapter, { foreignKey: "chapter_id", as: "chapter" });
QuizAttempt.hasMany(AttemptAnswer, { foreignKey: "attempt_id", as: "answers" });
AttemptAnswer.belongsTo(QuizAttempt, { foreignKey: "attempt_id", as: "attempt" });
AttemptAnswer.belongsTo(Question, { foreignKey: "question_id", as: "question" });
Flashcard.belongsTo(Chapter, { foreignKey: "chapter_id", as: "chapter" });
TutorSession.hasMany(TutorMessage, { foreignKey: "session_id", as: "messages" });
ChapterAudioSegment.belongsTo(TtsAudio, { foreignKey: "tts_audio_id", as: "audio" });
