import { Client } from "pg";
import { migrate } from "../scripts/migrate";

/** Recria o banco de teste do zero e aplica as migrações reais. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@localhost:5432/draum_test";
  const admin = new Client({ connectionString: url.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const db = url.split("/").pop()!;
  await admin.query(`drop database if exists ${db} with (force)`);
  await admin.query(`create database ${db}`);
  await admin.end();
  await migrate(url, false, () => {});
}
