"use strict";

// Bản dịch từng trang (cache): mở lại trang đã dịch không tốn lượt AI.
module.exports = {
  async up(q, S) {
    await q.createTable("page_translations", {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      document_id: { type: S.INTEGER, allowNull: false, references: { model: "documents", key: "id" }, onDelete: "CASCADE" },
      page: { type: S.INTEGER, allowNull: false },
      lang: { type: S.STRING(8), allowNull: false },
      text: { type: S.TEXT("medium"), allowNull: false },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
    });
    await q.addIndex("page_translations", ["document_id", "page", "lang"], { unique: true });
  },
  async down(q) {
    await q.dropTable("page_translations");
  },
};
