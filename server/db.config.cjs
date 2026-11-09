require("dotenv").config();
const base = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD || null,
  dialect: "mysql",
};
module.exports = { development: base, production: base };
