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

const cssPath='/src/frontend/src/styles.css';
let css=fs.readFileSync(cssPath,'utf8');
const marker='/* Visual mascot layout fix */';
if(!css.includes(marker)){
  css += `\n${marker}\n.top-actions .mascot-float{position:relative;left:auto;bottom:auto;z-index:20;display:flex;align-items:center;margin-left:4px}.top-actions .mascot-3d{width:52px;height:52px}.top-actions .mascot-orb{font-size:30px}.top-actions .mascot-shadow{width:38px;height:8px;left:7px}.top-actions .mascot-spark{font-size:13px;right:-1px;top:-2px}.top-actions .mascot-pop{right:0;left:auto;bottom:auto;top:58px}.top-actions .mascot-pop-3d{transform:none}\n@media(max-width:900px){.top-actions .mascot-float{display:none}}\n`;
  fs.writeFileSync(cssPath,css);
}
console.log('Visual mascot layout fix applied');
