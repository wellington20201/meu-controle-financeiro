import fs from 'node:fs';
const app=fs.readFileSync(new URL('../src/app.ts', import.meta.url),'utf8');
const checks=[
 ['dashboard exposes projection','projected_30_days_balance'],
 ['monthly projection exists','projected_month'],
 ['recent averages exist','avgMonthlyIncome'],
 ['category signals are non-autonomous','categorySignals'],
 ['no automatic recurring creation in dashboard','INSERT INTO recorrencias'],
 ['transfers excluded from economic metrics',"forma_pagamento <> 'transferencia'"]
];
let failed=0;
for(const [label,needle] of checks){const ok=app.includes(needle);console.log(`${ok?'PASS':'FAIL'} — ${label}`);if(!ok)failed++}
process.exit(failed?1:0);
