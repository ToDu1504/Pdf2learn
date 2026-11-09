"use strict";

/** Tự soạn trước bài giảng và tự dịch trước PDF ở nền (bật mặc định, tắt được trong Cài đặt). */
module.exports = {
  async up(q, S) {
    await q.addColumn("user_settings", "auto_prepare", { type: S.BOOLEAN, allowNull: false, defaultValue: true });
    await q.addColumn("user_settings", "auto_translate", { type: S.BOOLEAN, allowNull: false, defaultValue: true });
  },
  async down(q) {
    await q.removeColumn("user_settings", "auto_prepare");
    await q.removeColumn("user_settings", "auto_translate");
  },
};
