"use strict";

/**
 * Roadmap bám sát sách: lưu tên mục gốc trong sách cho chặng/bài học (để người học đối chiếu)
 * và báo cáo đối chiếu (trang được học / đoạn bị bỏ qua) cho mỗi tài liệu.
 */
module.exports = {
  async up(q, S) {
    await q.addColumn("chapters", "source_title", { type: S.STRING(500), allowNull: true });
    await q.addColumn("roadmap_sections", "source_title", { type: S.STRING(500), allowNull: true });
    await q.addColumn("documents", "roadmap_report", { type: S.JSON, allowNull: true });
  },
  async down(q) {
    await q.removeColumn("chapters", "source_title");
    await q.removeColumn("roadmap_sections", "source_title");
    await q.removeColumn("documents", "roadmap_report");
  },
};
