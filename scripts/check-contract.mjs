// contracts/pds-schema-v2.json 과 실제 DB 구조를 비교한다.
// 사용: DATABASE_URL=postgres://... node scripts/check-contract.mjs
// 읽기만 한다(information_schema 조회). 실제 DB에 써도 데이터는 바뀌지 않는다.
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const contract = JSON.parse(readFileSync(new URL('../contracts/pds-schema-v2.json', import.meta.url), 'utf8'));
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const problems = [];

const cols = await sql`
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns where table_schema = 'public'`;
const fks = await sql`
  select kcu.table_name || '.' || kcu.column_name as "from", ccu.table_name || '.' || ccu.column_name as "to"
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`;

const dbTables = new Set(cols.map((c) => c.table_name));
for (const [table, def] of Object.entries(contract.tables)) {
  if (!dbTables.has(table)) { problems.push(`DB에 테이블 없음: ${table}`); continue; }
  const dbCols = cols.filter((c) => c.table_name === table);
  for (const [name, c] of Object.entries(def.columns)) {
    const d = dbCols.find((x) => x.column_name === name);
    if (!d) { problems.push(`DB에 컬럼 없음: ${table}.${name}`); continue; }
    if (d.data_type !== c.type) problems.push(`타입 다름: ${table}.${name} 계약=${c.type} DB=${d.data_type}`);
    if ((d.is_nullable === 'YES') !== c.nullable) problems.push(`null 허용 다름: ${table}.${name} 계약=${c.nullable} DB=${d.is_nullable}`);
  }
  for (const d of dbCols) if (!def.columns[d.column_name]) problems.push(`계약에 없는 컬럼: ${table}.${d.column_name}`);
}
for (const t of dbTables) if (!contract.tables[t]) problems.push(`계약에 없는 테이블: ${t}`);
for (const r of contract.relations) if (!fks.some((f) => f.from === r.from && f.to === r.to)) problems.push(`DB에 FK 없음: ${r.from} → ${r.to}`);
for (const f of fks) if (!contract.relations.some((r) => r.from === f.from && r.to === f.to)) problems.push(`계약에 없는 FK: ${f.from} → ${f.to}`);

await sql.end();
const tables = Object.keys(contract.tables).length;
const columns = Object.values(contract.tables).reduce((a, t) => a + Object.keys(t.columns).length, 0);
if (problems.length) {
  console.log(`FAIL 계약과 DB가 다릅니다 (${problems.length}건)`);
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log(`PASS 계약 = DB (테이블 ${tables}개, 컬럼 ${columns}개, 관계 ${contract.relations.length}개)`);
