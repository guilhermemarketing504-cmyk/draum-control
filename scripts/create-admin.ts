/* Cria (ou reativa com nova senha) um administrador direto no banco — recuperação de acesso.
   Uso: npm run db:create-admin -- "Nome" email@dominio.com "senha-com-10+-caracteres" */
import { readFileSync, existsSync } from "fs";
import bcrypt from "bcryptjs";
import { Client } from "pg";

for (const f of [".env.local", ".env"]) if (existsSync(f)) for (const l of readFileSync(f, "utf8").split("\n")) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password || password.length < 10) { console.error('Uso: npm run db:create-admin -- "Nome" email "senha (mín. 10)"'); process.exit(1); }
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined });
  await c.connect();
  const hash = await bcrypt.hash(password, 12);
  await c.query(`insert into draum.users(name, email, password_hash, role, active) values ($1, lower($2), $3, 'admin', true)
    on conflict (email) do update set password_hash = excluded.password_hash, role = 'admin', active = true`, [name, email, hash]);
  await c.query(`insert into draum.audit_log(entity, entity_id, action) values ('user', lower($1), 'admin_via_cli')`, [email]);
  console.log(`Administrador ${email} pronto.`);
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
