import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '.');
const app = fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8');
const db = fs.readFileSync(path.join(root, 'src', 'db.ts'), 'utf8');
const checks = [
  ['RLS context is transaction-local', db.includes("set_config('app.user_id', $1, true)")],
  ['Authenticated queries run inside short transactions', db.includes("await client.query('BEGIN')") && db.includes("await client.query('COMMIT')")],
  ['Request context is bound to authenticated user', app.includes('securityContext.enterWith({ userId: req.userId })')],
  ['All explicit DB transactions set RLS context', (app.match(/client\.query\('BEGIN'\)/g) || []).length === (app.match(/setUserContext\(client,\s*id\)/g) || []).length],
  ['Sensitive routes require CSRF through global hook', app.includes('await requireCsrf(req)')],
  ['Protected routes use authenticated user ID', app.includes('const userId=(req:any)=>req.userId as string')],
  ['No Authorization header token storage path remains', !app.includes('localStorage')],
  ['No raw password logging configuration', !app.includes("redact:[]")],
];
let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}`);
  if (!ok) failed++;
}
process.exitCode = failed ? 1 : 0;
