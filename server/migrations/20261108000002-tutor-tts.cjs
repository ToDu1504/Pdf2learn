"use strict";
const ts = (S) => ({
  created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
  updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
});
const id = (S) => ({ type: S.INTEGER, autoIncrement: true, primaryKey: true });
const fk = (S, table) => ({
  type: S.INTEGER, allowNull: false, references: { model: table, key: "id" }, onDelete: "CASCADE",
});

module.exports = {
  async up(q, S) {
    await q.createTable("tutor_sessions", {
      id: id(S),
      user_id: fk(S, "users"),
      document_id: fk(S, "documents"),
      title: { type: S.STRING, allowNull: false },
      ...ts(S),
    });
    await q.createTable("tutor_messages", {
      id: id(S),
      session_id: fk(S, "tutor_sessions"),
      role: { type: S.ENUM("user", "model", "tool"), allowNull: false },
      content: { type: S.TEXT("medium"), allowNull: false },
      tool_calls: { type: S.JSON, allowNull: true },
      ...ts(S),
    });
    await q.createTable("tts_audios", {
      id: id(S),
      hash: { type: S.CHAR(64), allowNull: false, unique: true },
      voice: { type: S.STRING, allowNull: false },
      text: { type: S.TEXT, allowNull: false },
      file_path: { type: S.STRING, allowNull: true },
      duration_ms: { type: S.INTEGER, allowNull: true },
      size_bytes: { type: S.INTEGER, allowNull: true },
      status: { type: S.ENUM("pending", "done", "failed"), allowNull: false, defaultValue: "pending" },
      last_used_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      ...ts(S),
    });
    await q.createTable("chapter_audio_segments", {
      id: id(S),
      chapter_id: fk(S, "chapters"),
      voice: { type: S.STRING, allowNull: false },
      order_index: { type: S.INTEGER, allowNull: false },
      display_text: { type: S.TEXT, allowNull: false },
      tts_audio_id: fk(S, "tts_audios"),
      ...ts(S),
    });
    await q.addIndex("tutor_messages", ["session_id"]);
    await q.addIndex("chapter_audio_segments", ["chapter_id", "voice", "order_index"]);
    await q.addIndex("tts_audios", ["status", "last_used_at"]);
  },
  async down(q) {
    for (const t of ["chapter_audio_segments", "tts_audios", "tutor_messages", "tutor_sessions"]) await q.dropTable(t);
  },
};
