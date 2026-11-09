"use strict";

/**
 * Phần ôn tập của sách (đọc bằng code, không dùng AI):
 *   questions.origin       : "ai" (AI soạn) | "book" (câu hỏi in trong sách, đáp án theo sách)
 *   roadmap_sections.review: tóm tắt phần ôn tập của chương (số câu hỏi, thuật ngữ/ý cần nắm, bài lab)
 */
module.exports = {
  async up(q, S) {
    await q.addColumn("questions", "origin", { type: S.ENUM("ai", "book"), allowNull: false, defaultValue: "ai" });
    await q.addColumn("roadmap_sections", "review", { type: S.JSON, allowNull: true });
  },
  async down(q) {
    await q.removeColumn("questions", "origin");
    await q.removeColumn("roadmap_sections", "review");
  },
};
