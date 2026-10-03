import fs from 'node:fs';
const path='/src/backend/src/app.ts';
let s=fs.readFileSync(path,'utf8');
const old="""  app.addHook('preHandler',async(req,rep)=>{\n    const requestPath=req.url.split('?')[0];\n    if(publicPaths.has(requestPath) || requestPath.startsWith('/api/')===false || req.method==='OPTIONS') return;\n    await authenticate(req,rep);\n    await requireCsrf(req);\n    securityContext.enterWith({ userId: (req as any).userId });\n  });""";
const next="""  app.addHook('onRequest',(req,rep,done)=>{\n    const requestPath=req.url.split('?')[0];\n    if(publicPaths.has(requestPath) || requestPath.startsWith('/api/')===false || req.method==='OPTIONS') return done();\n    (async()=>{\n      try{\n        await authenticate(req,rep);\n        await requireCsrf(req);\n        const uid=(req as any).userId as string;\n        securityContext.run({userId:uid},()=>done());\n      }catch(error){ done(error as Error); }\n    })();\n  });""";
if(!s.includes(old)) throw new Error('RLS hook block not found');
s=s.replace(old,next);
fs.writeFileSync(path,s);
console.log('RLS request context patch applied');
