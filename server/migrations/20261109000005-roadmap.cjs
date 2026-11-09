"use strict";

/**
 * Roadmap: tài liệu → section (chặng, thường là 1 chương sách) → chapters (mỗi dòng là 1 BÀI HỌC/chủ đề).
 * Giữ bảng `chapters` làm đơn vị học để tái dùng tóm tắt, câu hỏi, flashcard, gia sư, audio.
 */
module.exports = {
  async up(q, S) {
    await q.createTable("roadmap_sections", {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      document_id: { type: S.INTEGER, allowNull: false, references: { model: "documents", key: "id" }, onDelete: "CASCADE" },
      order_index: { type: S.INTEGER, allowNull: false },
      title: { type: S.STRING, allowNull: false },
      description: { type: S.TEXT, allowNull: true },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
    });
    await q.addIndex("roadmap_sections", ["document_id", "order_index"]);

    await q.addColumn("chapters", "section_id", {
      type: S.INTEGER,
      allowNull: true,
      references: { model: "roadmap_sections", key: "id" },
      onDelete: "CASCADE",
    });
    await q.addColumn("chapters", "description", { type: S.TEXT, allowNull: true });
    await q.addColumn("chapters", "importance", { type: S.ENUM("core", "optional"), allowNull: false, defaultValue: "core" });
    await q.addColumn("chapters", "est_minutes", { type: S.INTEGER, allowNull: true });
    await q.addColumn("chapters", "completed_at", { type: S.DATE, allowNull: true });

    await q.addColumn("summaries", "lesson_md", { type: S.TEXT("medium"), allowNull: true });
  },
  async down(q) {
    await q.removeColumn("summaries", "lesson_md");
    for (const c of ["completed_at", "est_minutes", "importance", "description", "section_id"]) await q.removeColumn("chapters", c);
    await q.dropTable("roadmap_sections");
  },
};
