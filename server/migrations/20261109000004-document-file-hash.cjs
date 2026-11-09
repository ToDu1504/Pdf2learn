"use strict";

// sha256 nội dung file PDF: cùng 1 file upload lại (hoặc người khác upload trùng) thì dùng lại kết quả AI.
module.exports = {
  async up(q, S) {
    await q.addColumn("documents", "file_hash", { type: S.CHAR(64), allowNull: true });
    await q.addIndex("documents", ["file_hash"]);
  },
  async down(q) {
    await q.removeColumn("documents", "file_hash");
  },
};
