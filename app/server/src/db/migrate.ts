import { SequelizeStorage, Umzug } from "umzug";
import { configureSqlite, sequelize } from "../config/db.js";
import * as baseline from "./migrations/0001-baseline.js";

/**
 * Migration chạy ngay khi app khởi động (app desktop không có sequelize-cli). Thêm migration mới: tạo file
 * migrations/000N-ten.ts (export up/down) rồi khai báo vào danh sách dưới đây, theo thứ tự.
 */
const migrations = [{ name: "0001-baseline", ...baseline }];

export async function migrate() {
  await configureSqlite();
  const umzug = new Umzug({
    migrations: migrations.map((m) => ({ name: m.name, up: m.up, down: m.down })),
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize, tableName: "schema_migrations" }),
    logger: undefined,
  });
  const done = await umzug.up();
  if (done.length) console.log(`[db] đã chạy ${done.length} migration: ${done.map((m) => m.name).join(", ")}`);
}
