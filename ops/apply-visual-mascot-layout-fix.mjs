import fs from 'node:fs';

const appPath='/src/frontend/src/main.tsx';
let app=fs.readFileSync(appPath,'utf8');

const oldMascotButton='<button className="mascot-mini" onClick={()=>setPage(\'config\')}>{mascot.emoji}<span>{mascot.name}</span></button>';
const newMascot='<MascotBubble mascot={mascot} page={page}/>';
if(!app.includes(oldMascotButton)) throw new Error('mascot mini button not found');
app=app.replace(oldMascotButton,newMascot);

const oldQuick='<button className="quick-add" onClick={()=>setPage(\'lancamentos\')} aria-label="Novo lançamento"><Plus size={22}/><span>Novo lançamento</span></button>';
if(!app.includes(oldQuick)) throw new Error('quick add button not found');
app=app.replace(oldQuick,'');

const oldBottom='<MascotBubble mascot={mascot} page={page}/></div>}';
const newBottom='</div>}';
if(!app.includes(oldBottom)) throw new Error('bottom mascot mount not found');
app=app.replace(oldBottom,newBottom);

fs.writeFileSync(appPath,app);
console.log('Visual mascot layout fix applied');
