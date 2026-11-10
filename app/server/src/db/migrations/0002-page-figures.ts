import { DataTypes as S, type QueryInterface } from "sequelize";

/** Hình minh họa của từng trang (vị trí trên trang + chú thích), tính khi cần; NULL = chưa tính. */
export async function up({ context: q }: { context: QueryInterface }) {
  await q.addColumn("document_pages", "figures", { type: S.JSON, allowNull: true });
}

export async function down({ context: q }: { context: QueryInterface }) {
  await q.removeColumn("document_pages", "figures");
}
