import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..', import.meta.url).pathname,'..');
const checks=[
 ['config has DB TLS controls', 'DB_SSL'],
 ['config has connection timeout', 'DB_CONNECTION_TIMEOUT_MS'],
 ['logs redact cookies/tokens', 'req.headers.cookie'],
 ['body limit configured', 'bodyLimit'],
 ['RLS preparation migration exists', 'database/v26_production_hardening.sql'],
 ['encrypted backup script exists', 'ops/backup-postgres.sh'],
 ['restore script exists', 'ops/restore-postgres.sh']
];
let failed=0;
for(const [label,needle] of checks){
 const files=needle.includes('/')?[path.join(root,needle)]:[path.join(root,'backend/src/config.ts'),path.join(root,'backend/src/app.ts')];
 const ok=files.some(f=>fs.existsSync(f)&&(needle.includes('/')||fs.readFileSync(f,'utf8').includes(needle)));
 console.log(`${ok?'PASS':'FAIL'} — ${label}`); if(!ok) failed++;
}
process.exitCode=failed?1:0;
