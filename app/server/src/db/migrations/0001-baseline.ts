import { DataTypes as S, type QueryInterface } from "sequelize";

/**
 * Lược đồ nền của app desktop (SQLite) = lược đồ của bản web sau 11 migration MySQL (tới 20261110000011),
 * gộp lại thành 1 bước. Migration mới của app thêm file 0002-..., 0003-... trong thư mục này.
 * ENUM/JSON lưu thành TEXT trong SQLite; model Sequelize vẫn khai báo như cũ.
 */
const ts = {
  created_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
  updated_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
};
const id = { type: S.INTEGER, autoIncrement: true, primaryKey: true };
const fk = (table: string, allowNull = false) => ({
  type: S.INTEGER,
  allowNull,
  references: { model: table, key: "id" },
  onDelete: "CASCADE",
});

export async function up({ context: q }: { context: QueryInterface }) {
  await q.createTable("users", {
    id,
    email: { type: S.STRING, allowNull: false, unique: true },
    password_hash: { type: S.STRING, allowNull: false },
    full_name: { type: S.STRING, allowNull: false },
    ...ts,
  });
  await q.createTable("user_settings", {
    user_id: { ...fk("users"), primaryKey: true },
    theme: { type: S.ENUM("light", "dark", "system"), allowNull: false, defaultValue: "system" },
    auto_prepare: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
    auto_translate: { type: S.BOOLEAN, allowNull: false, defaultValue: true },
    ...ts,
  });
  await q.createTable("documents", {
    id,
    user_id: fk("users"),
    title: { type: S.STRING, allowNull: false },
    file_path: { type: S.STRING, allowNull: false },
    file_size: { type: S.INTEGER, allowNull: false },
    file_hash: { type: S.CHAR(64), allowNull: true },
    page_count: { type: S.INTEGER, allowNull: true },
    status: { type: S.ENUM("queued", "processing", "done", "failed"), allowNull: false, defaultValue: "queued" },
    current_step: { type: S.STRING, allowNull: true },
    progress: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    error_message: { type: S.TEXT, allowNull: true },
    roadmap_report: { type: S.JSON, allowNull: true },
    ...ts,
  });
  await q.createTable("roadmap_sections", {
    id,
    document_id: fk("documents"),
    order_index: { type: S.INTEGER, allowNull: false },
    title: { type: S.STRING, allowNull: false },
    source_title: { type: S.STRING(500), allowNull: true },
    description: { type: S.TEXT, allowNull: true },
    review: { type: S.JSON, allowNull: true },
    ...ts,
  });
  await q.createTable("chapters", {
    id,
    document_id: fk("documents"),
    section_id: fk("roadmap_sections", true),
    order_index: { type: S.INTEGER, allowNull: false },
    title: { type: S.STRING, allowNull: false },
    source_title: { type: S.STRING(500), allowNull: true },
    start_page: { type: S.INTEGER, allowNull: false },
    end_page: { type: S.INTEGER, allowNull: false },
    gemini_file_uri: { type: S.STRING, allowNull: true },
    gemini_file_expires_at: { type: S.DATE, allowNull: true },
    status: { type: S.ENUM("pending", "done", "failed"), allowNull: false, defaultValue: "pending" },
    description: { type: S.TEXT, allowNull: true },
    importance: { type: S.ENUM("core", "optional"), allowNull: false, defaultValue: "core" },
    est_minutes: { type: S.INTEGER, allowNull: true },
    completed_at: { type: S.DATE, allowNull: true },
    subtopics: { type: S.JSON, allowNull: true },
    ...ts,
  });
  await q.createTable("summaries", {
    id,
    chapter_id: { ...fk("chapters"), unique: true },
    overview: { type: S.TEXT, allowNull: false },
    key_points: { type: S.JSON, allowNull: false },
    key_terms: { type: S.JSON, allowNull: false },
    mindmap_mermaid: { type: S.TEXT, allowNull: true },
    lesson_md: { type: S.TEXT, allowNull: true },
    evidence: { type: S.JSON, allowNull: true },
    grounding: { type: S.JSON, allowNull: true },
    ...ts,
  });
  await q.createTable("questions", {
    id,
    chapter_id: fk("chapters"),
    type: { type: S.ENUM("mcq", "true_false", "short_answer"), allowNull: false },
    difficulty: { type: S.ENUM("easy", "medium", "hard"), allowNull: false },
    content: { type: S.TEXT, allowNull: false },
    options: { type: S.JSON, allowNull: true },
    correct_answer: { type: S.TEXT, allowNull: false },
    explanation: { type: S.TEXT, allowNull: false },
    source_page: { type: S.INTEGER, allowNull: false },
    topic: { type: S.STRING, allowNull: false },
    source_quote: { type: S.TEXT, allowNull: true },
    verified: { type: S.BOOLEAN, allowNull: true },
    origin: { type: S.ENUM("ai", "book"), allowNull: false, defaultValue: "ai" },
    ...ts,
  });
  await q.createTable("quiz_attempts", {
    id,
    user_id: fk("users"),
    document_id: fk("documents"),
    mode: { type: S.ENUM("chapter", "mixed", "weak", "exam"), allowNull: false },
    total_questions: { type: S.INTEGER, allowNull: false },
    correct_count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    score: { type: S.DECIMAL(5, 2), allowNull: true },
    started_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    finished_at: { type: S.DATE, allowNull: true },
    ...ts,
  });
  await q.createTable("attempt_answers", {
    id,
    attempt_id: fk("quiz_attempts"),
    question_id: fk("questions"),
    user_answer: { type: S.TEXT, allowNull: true },
    is_correct: { type: S.BOOLEAN, allowNull: true },
    ai_score: { type: S.DECIMAL(4, 2), allowNull: true },
    ai_feedback: { type: S.TEXT, allowNull: true },
    ...ts,
  });
  await q.createTable("flashcards", {
    id,
    chapter_id: fk("chapters"),
    user_id: fk("users"),
    front: { type: S.TEXT, allowNull: false },
    back: { type: S.TEXT, allowNull: false },
    ease_factor: { type: S.FLOAT, allowNull: false, defaultValue: 2.5 },
    interval_days: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    repetitions: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    next_review_at: { type: S.DATE, allowNull: false, defaultValue: S.NOW },
    ...ts,
  });
  await q.createTable("ai_usage_logs", {
    id,
    user_id: fk("users"),
    feature: { type: S.STRING, allowNull: false },
    input_tokens: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    output_tokens: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
    ...ts,
  });
  await q.createTable("tutor_sessions", {
    id,
    user_id: fk("users"),
    document_id: fk("documents"),
    title: { type: S.STRING, allowNull: false },
    ...ts,
  });
  await q.createTable("tutor_messages", {
    id,
    session_id: fk("tutor_sessions"),
    role: { type: S.ENUM("user", "model", "tool"), allowNull: false },
    content: { type: S.TEXT, allowNull: false },
    tool_calls: { type: S.JSON, allowNull: true },
    ...ts,
  });
  await q.createTable("document_pages", {
    id,
    document_id: fk("documents"),
    page: { type: S.INTEGER, allowNull: false },
    text: { type: S.TEXT, allowNull: false },
    ...ts,
  });
  await q.createTable("page_translations", {
    id,
    document_id: fk("documents"),
    page: { type: S.INTEGER, allowNull: false },
    lang: { type: S.STRING(8), allowNull: false },
    text: { type: S.TEXT, allowNull: false },
    ...ts,
  });

  await q.addIndex("documents", ["user_id"]);
  await q.addIndex("documents", ["file_hash"]);
  await q.addIndex("roadmap_sections", ["document_id", "order_index"]);
  await q.addIndex("chapters", ["document_id", "order_index"]);
  await q.addIndex("questions", ["chapter_id"]);
  await q.addIndex("flashcards", ["user_id", "next_review_at"]);
  await q.addIndex("document_pages", ["document_id", "page"], { unique: true });
  await q.addIndex("page_translations", ["document_id", "page", "lang"], { unique: true });
}

export async function down({ context: q }: { context: QueryInterface }) {
  for (const t of [
    "page_translations",
    "document_pages",
    "tutor_messages",
    "tutor_sessions",
    "ai_usage_logs",
    "flashcards",
    "attempt_answers",
    "quiz_attempts",
    "questions",
    "summaries",
    "chapters",
    "roadmap_sections",
    "documents",
    "user_settings",
    "users",
  ])
    await q.dropTable(t);
}
