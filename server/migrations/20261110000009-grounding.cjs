"use strict";

/**
 * Kiểm chứng nội dung AI với sách: câu trích nguyên văn (quote) cho từng ý và kết quả đối chiếu.
 *   chapters.subtopics   : mục con trong mục lục sách của bài (để kiểm tra bài giảng có sót mục nào)
 *   summaries.evidence   : câu trích của bài giảng [{k, page, quote, verified}]
 *   summaries.grounding  : thống kê đối chiếu (đã kiểm chứng / bị loại / mục con chưa nói tới)
 *   questions.source_quote, questions.verified
 */
module.exports = {
  async up(q, S) {
    await q.addColumn("chapters", "subtopics", { type: S.JSON, allowNull: true });
    await q.addColumn("summaries", "evidence", { type: S.JSON, allowNull: true });
    await q.addColumn("summaries", "grounding", { type: S.JSON, allowNull: true });
    await q.addColumn("questions", "source_quote", { type: S.TEXT, allowNull: true });
    await q.addColumn("questions", "verified", { type: S.BOOLEAN, allowNull: true });
  },
  async down(q) {
    await q.removeColumn("chapters", "subtopics");
    await q.removeColumn("summaries", "evidence");
    await q.removeColumn("summaries", "grounding");
    await q.removeColumn("questions", "source_quote");
    await q.removeColumn("questions", "verified");
  },
};
