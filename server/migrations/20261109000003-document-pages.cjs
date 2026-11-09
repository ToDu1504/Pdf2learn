"use strict";

module.exports = {
  async up(q, S) {
    await q.createTable("document_pages", {
      id: { type: S.INTEGER, autoIncrement: true, primaryKey: true },
      document_id: {
        type: S.INTEGER,
        allowNull: false,
        references: { model: "documents", key: "id" },
        onDelete: "CASCADE",
      },
      page: { type: S.INTEGER, allowNull: false },
      text: { type: S.TEXT("medium"), allowNull: false },
      created_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
      updated_at: { type: S.DATE, allowNull: false, defaultValue: S.fn("NOW") },
    });
    await q.addIndex("document_pages", ["document_id", "page"], { unique: true });
  },
  async down(q) {
    await q.dropTable("document_pages");
  },
};
