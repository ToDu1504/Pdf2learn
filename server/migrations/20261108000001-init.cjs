"use strict";
const ts = (S) => ({
  created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
  updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
});
const id = (S) => ({ type: S.INTEGER, autoIncrement: true, primaryKey: true });
const fk = (S, table, allowNull = false) => ({
  type: S.INTEGER, allowNull, references: { model: table, key: "id" }, onDelete: "CASCADE",
});

module.exports = {
  async up(q, S) {
    await q.createTable("users", {
      id: id(S),
      email: { type: S.STRING, allowNull: false, unique: true },
      password_hash: { type: S.STRING, allowNull: false },
      full_name: { type: S.STRING, allowNull: false },
      ...ts(S),
    });
    await q.createTable("user_settings", {
      user_id: { ...fk(S, "users"), primaryKey: true },
      tts_voice: { type: S.STRING, allowNull: false, defaultValue: "Hải Đăng" },
      tts_rate: { type: S.FLOAT, allowNull: false, defaultValue: 1 },
      auto_read_tutor: { type: S.BOOLEAN, allowNull: false, defaultValue: false },
      theme: { type: S.ENUM("light", "dark", "system"), allowNull: false, defaultValue: "system" },
      ...ts(S),
    });
    await q.createTable("documents", {
      id: id(S),
      user_id: fk(S, "users"),
      title: { type: S.STRING, allowNull: false },
      file_path: { type: S.STRING, allowNull: false },
      file_size: { type: S.INTEGER, allowNull: false },
      page_count: { type: S.INTEGER, allowNull: true },
      status: { type: S.ENUM("queued", "processing", "done", "failed"), allowNull: false, defaultValue: "queued" },
      current_step: { type: S.STRING, allowNull: true },
      progress: { type: S.TINYINT, allowNull: false, defaultValue: 0 },
      error_message: { type: S.TEXT, allowNull: true },
      ...ts(S),
    });
    await q.createTable("chapters", {
      id: id(S),
      document_id: fk(S, "documents"),
      order_index: { type: S.INTEGER, allowNull: false },
      title: { type: S.STRING, allowNull: false },
      start_page: { type: S.INTEGER, allowNull: false },
      end_page: { type: S.INTEGER, allowNull: false },
      gemini_file_uri: { type: S.STRING, allowNull: true },
      gemini_file_expires_at: { type: S.DATE, allowNull: true },
      status: { type: S.ENUM("pending", "done", "failed"), allowNull: false, defaultValue: "pending" },
      ...ts(S),
    });
    await q.createTable("summaries", {
      id: id(S),
      chapter_id: { ...fk(S, "chapters"), unique: true },
      overview: { type: S.TEXT, allowNull: false },
      key_points: { type: S.JSON, allowNull: false },
      key_terms: { type: S.JSON, allowNull: false },
      mindmap_mermaid: { type: S.TEXT, allowNull: true },
      ...ts(S),
    });
    await q.createTable("questions", {
      id: id(S),
      chapter_id: fk(S, "chapters"),
      type: { type: S.ENUM("mcq", "true_false", "short_answer"), allowNull: false },
      difficulty: { type: S.ENUM("easy", "medium", "hard"), allowNull: false },
      content: { type: S.TEXT, allowNull: false },
      options: { type: S.JSON, allowNull: true },
      correct_answer: { type: S.TEXT, allowNull: false },
      explanation: { type: S.TEXT, allowNull: false },
      source_page: { type: S.INTEGER, allowNull: false },
      topic: { type: S.STRING, allowNull: false },
      ...ts(S),
    });
    await q.createTable("quiz_attempts", {
      id: id(S),
      user_id: fk(S, "users"),
      document_id: fk(S, "documents"),
      mode: { type: S.ENUM("chapter", "mixed", "weak", "exam"), allowNull: false },
      total_questions: { type: S.INTEGER, allowNull: false },
      correct_count: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      score: { type: S.DECIMAL(5, 2), allowNull: true },
      started_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      finished_at: { type: S.DATE, allowNull: true },
      ...ts(S),
    });
    await q.createTable("attempt_answers", {
      id: id(S),
      attempt_id: fk(S, "quiz_attempts"),
      question_id: fk(S, "questions"),
      user_answer: { type: S.TEXT, allowNull: true },
      is_correct: { type: S.BOOLEAN, allowNull: true },
      ai_score: { type: S.DECIMAL(4, 2), allowNull: true },
      ai_feedback: { type: S.TEXT, allowNull: true },
      ...ts(S),
    });
    await q.createTable("flashcards", {
      id: id(S),
      chapter_id: fk(S, "chapters"),
      user_id: fk(S, "users"),
      front: { type: S.TEXT, allowNull: false },
      back: { type: S.TEXT, allowNull: false },
      ease_factor: { type: S.FLOAT, allowNull: false, defaultValue: 2.5 },
      interval_days: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      repetitions: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      next_review_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      ...ts(S),
    });
    await q.createTable("ai_usage_logs", {
      id: id(S),
      user_id: fk(S, "users"),
      feature: { type: S.STRING, allowNull: false },
      input_tokens: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      output_tokens: { type: S.INTEGER, allowNull: false, defaultValue: 0 },
      ...ts(S),
    });
    await q.addIndex("documents", ["user_id"]);
    await q.addIndex("chapters", ["document_id", "order_index"]);
    await q.addIndex("questions", ["chapter_id"]);
    await q.addIndex("flashcards", ["user_id", "next_review_at"]);
  },
  async down(q) {
    for (const t of ["ai_usage_logs", "flashcards", "attempt_answers", "quiz_attempts", "questions",
      "summaries", "chapters", "documents", "user_settings", "users"]) await q.dropTable(t);
  },
};
