"use strict";

// Bỏ tính năng đọc to (TTS): xóa bảng audio và cột cài đặt giọng đọc.
module.exports = {
  async up(q) {
    await q.dropTable("chapter_audio_segments");
    await q.dropTable("tts_audios");
    for (const col of ["tts_voice", "tts_rate", "auto_read_tutor"]) await q.removeColumn("user_settings", col);
  },
  async down(q, S) {
    await q.addColumn("user_settings", "tts_voice", { type: S.STRING, allowNull: false, defaultValue: "Hải Đăng" });
    await q.addColumn("user_settings", "tts_rate", { type: S.FLOAT, allowNull: false, defaultValue: 1 });
    await q.addColumn("user_settings", "auto_read_tutor", { type: S.BOOLEAN, allowNull: false, defaultValue: false });
    // Bảng audio không tạo lại: tính năng đã gỡ khỏi code.
  },
};
