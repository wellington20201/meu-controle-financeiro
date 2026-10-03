import Fastify from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { query, pool, securityContext, setUserContext } from './db.js';
import crypto from 'node:crypto';
import { authenticate, clearSessionCookie, createSession, decryptSecret, encryptSecret, hashPassword, base32Encode, randomToken, requireCsrf, setSessionCookie, sha256, verifyPassword, verifyTotp } from './auth.js';
import { env } from './config.js';

const webRoot = path.resolve(process.env.WEB_ROOT ?? './public');

const mascotes = ['bento','nico','luna','tito','pip'];
const periodicidades = ['semanal','quinzenal','mensal','bimestral','trimestral','semestral','anual','personalizada'];

const n=(v:any)=>Number(v||0);
const money=(v:any)=>Math.round(n(v)*100)/100;
const brl=(v:any)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n(v));
const dateOnly=(d:any)=>d instanceof Date?d.toISOString().slice(0,10):String(d).slice(0,10);
const addPeriod=(base:Date,period:string)=>{const d=new Date(base); if(period==='semanal') d.setDate(d.getDate()+7); else if(period==='quinzenal') d.setDate(d.getDate()+14); else if(period==='mensal') d.setMonth(d.getMonth()+1); else if(period==='bimestral') d.setMonth(d.getMonth()+2); else if(period==='trimestral') d.setMonth(d.getMonth()+3); else if(period==='semestral') d.setMonth(d.getMonth()+6); else if(period==='anual') d.setFullYear(d.getFullYear()+1); else d.setDate(d.getDate()+30); return d;};
const clampDay=(year:number,month:number,day:number)=>{const last=new Date(year,month+1,0).getDate();return Math.min(Math.max(1,day||1),last)};
const nextOccurrence=(base:Date,r:any)=>{let d=addPeriod(base,r.periodicidade); if(['mensal','bimestral','trimestral','semestral','anual'].includes(r.periodicidade)&&r.dia_cobranca){const day=clampDay(d.getFullYear(),d.getMonth(),Number(r.dia_cobranca)); d=new Date(d.getFullYear(),d.getMonth(),day);} return d;};
async function syncRecurringPaymentsForUser(userId:string, horizonDays=90){
  const recs=await query(`SELECT * FROM recorrencias WHERE usuario_id=$1 AND ativa=true AND gerar_automaticamente=true`,[userId]);
  const today=new Date(); today.setHours(12,0,0,0); const horizon=new Date(today); horizon.setDate(horizon.getDate()+horizonDays);
  for(const r of recs.rows){
    let last=await query(`SELECT data_prevista FROM pagamentos_recorrentes WHERE recorrencia_id=$1 ORDER BY data_prevista DESC LIMIT 1`,[r.id]);
    let current=last.rowCount?new Date(`${dateOnly(last.rows[0].data_prevista)}T12:00:00`):new Date(`${dateOnly(r.data_inicio)}T12:00:00`);
    if(!last.rowCount){
      if(current<today){ while(current<today) current=nextOccurrence(current,r); }
    }
    while(current<=horizon && (!r.data_fim || current<=new Date(`${dateOnly(r.data_fim)}T12:00:00`))){
      const expected=r.valor_variavel?null:n(r.valor);
      await query(`INSERT INTO pagamentos_recorrentes(recorrencia_id,data_prevista,valor_previsto,status) VALUES($1,$2,$3,'previsto') ON CONFLICT (recorrencia_id,data_prevista) DO NOTHING`,[r.id,dateOnly(current),expected]);
      current=nextOccurrence(current,r);
    }
  }
  await query(`UPDATE pagamentos_recorrentes pr SET status='atrasado',atualizado_em=now() FROM recorrencias r WHERE pr.recorrencia_id=r.id AND r.usuario_id=$1 AND pr.status IN ('previsto','pendente') AND pr.data_prevista<CURRENT_DATE`,[userId]);
}

const uploadMimeBySignature=(buf:Buffer)=>{
  if(buf.subarray(0,5).toString('ascii')==='%PDF-') return 'application/pdf';
  if(buf.length>=3 && buf[0]===0xff && buf[1]===0xd8 && buf[2]===0xff) return 'image/jpeg';
  if(buf.length>=8 && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if(buf.length>=12 && buf.subarray(0,4).toString('ascii')==='RIFF' && buf.subarray(8,12).toString('ascii')==='WEBP') return 'image/webp';
  return null;
};
const safeOriginalName=(name:string)=>{ const base=path.basename(String(name||'arquivo')).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120); return base || 'arquivo'; };
const extensionForMime=(mime:string)=>({ 'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp' } as Record<string,string>)[mime]||'';

export async function buildApp(){
  const app=Fastify({
    logger:{
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      redact:['req.headers.authorization','req.headers.cookie','res.headers.set-cookie','*.password','*.senha','*.senha_hash','*.token','*.challenge_token','*.dev_token','*.mfa_secret_enc','*.csrf_token']
    },
    trustProxy:env.TRUST_PROXY,
    bodyLimit: 256 * 1024
  });
  await app.register(cookie);
  await app.register((await import('@fastify/multipart')).default, { limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 10 } });
  await app.register(helmet,{hidePoweredBy:true,referrerPolicy:{policy:'no-referrer'},contentSecurityPolicy:{directives:{defaultSrc:["'self'"],objectSrc:["'none'"],baseUri:["'self'"],frameAncestors:["'none'"],formAction:["'self'"],imgSrc:["'self'","data:","https:"],styleSrc:["'self'","'unsafe-inline'"],scriptSrc:["'self'"],connectSrc:["'self'","https:"]}}});
  await app.register(rateLimit,{global:true,max:120,timeWindow:'1 minute',hook:'onRequest'});
  const origins=env.CORS_ORIGIN.split(',').map(x=>x.trim()).filter(Boolean);
  await app.register(cors,{origin:origins.length===1?origins[0]:origins,credentials:true,methods:['GET','HEAD','POST','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-CSRF-Token']});

  app.setErrorHandler((error,req,rep)=>{
    req.log.error({err:error},'request_failed');
    if((error as any).message==='UNAUTHORIZED') return rep.code(401).send({message:'Sessão inválida ou expirada'});
    if((error as any).message==='CSRF_INVALID') return rep.code(403).send({message:'Validação de segurança inválida. Atualize a página e tente novamente.'});
    if((error as any).code==='23505') return rep.code(409).send({message:'Esse dado já está cadastrado.'});
    return rep.code(500).send({message:'Não foi possível concluir a operação'});
  });

  const publicPaths=new Set(['/api/auth/register','/api/auth/login','/api/auth/mfa/verify','/api/auth/recuperar-senha','/api/auth/redefinir-senha','/health','/health/database']);
  app.addHook('preHandler',async(req,rep)=>{
    const requestPath=req.url.split('?')[0];
    if(publicPaths.has(requestPath) || requestPath.startsWith('/api/')===false || req.method==='OPTIONS') return;
    await authenticate(req,rep);
    await requireCsrf(req);
    securityContext.enterWith({ userId: (req as any).userId });
  });

  const audit=async(req:any,event:string,success=true,userId:string|null=null,details:any={})=>{
    try{await query(`INSERT INTO auditoria_seguranca(usuario_id,evento,sucesso,ip,user_agent,detalhes) VALUES($1,$2,$3,$4,$5,$6)`,[userId??req.userId??null,event,success,req.ip??null,req.headers['user-agent']?.slice(0,500)??null,details])}catch(e){req.log.error({err:e},'audit_write_failed')}
  };
  const passwordError=(password:string)=>{
    if(typeof password!=='string'||password.length<12)return 'A senha precisa ter pelo menos 12 caracteres.';
    if(password.length>128)return 'A senha não pode ter mais de 128 caracteres.';
    return null;
  };
  const userId=(req:any)=>req.userId as string;

  app.get('/health',async()=>({ok:true,service:'meu-controle-financeiro',version:'3.4'}));
  app.get('/health/database',async()=>{await query('SELECT 1');return {ok:true,database:true}});

  app.post('/api/auth/register',{config:{rateLimit:{max:5,timeWindow:'10 minutes'}}},async(req:any,rep)=>{
    const {email,password,nome,aceite_privacidade,versao_privacidade}=req.body||{};
    const emailNorm=String(email||'').toLowerCase().trim();
    if(aceite_privacidade!==true || String(versao_privacidade||'')!=='1.0') return rep.code(400).send({message:'É necessário aceitar a Política de Privacidade atual para criar a conta.'});
    const pwErr=passwordError(password);
    if(!emailNorm||!password) return rep.code(400).send({message:'E-mail e senha são obrigatórios'});
    if(pwErr) return rep.code(400).send({message:pwErr});
    const hash=await hashPassword(password);
    const client=await pool.connect();
    let createdUser:any;
    try{
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO usuarios(email,senha_hash,nome,mascote_id) VALUES($1,$2,$3,'bento') RETURNING id,email,nome,moeda,mascote_id`,[emailNorm,hash,nome||null]);
      createdUser=r.rows[0];
      await client.query(`SELECT set_config('app.user_id',$1,true)`,[createdUser.id]);
      await client.query(`INSERT INTO consentimentos_privacidade(usuario_id,versao_politica,tipo,aceito,ip,user_agent) VALUES($1,'1.0','politica_privacidade',true,$2,$3)`,[createdUser.id,req.ip??null,req.headers['user-agent']?.slice(0,500)??null]);
      await client.query(`INSERT INTO auditoria_seguranca(usuario_id,evento,sucesso,ip,user_agent,detalhes) VALUES($1,'CONTA_CRIADA',true,$2,$3,$4)`,[createdUser.id,req.ip??null,req.headers['user-agent']?.slice(0,500)??null,{}]);
      await client.query('COMMIT');
    }catch(error){
      await client.query('ROLLBACK').catch(()=>undefined);
      throw error;
    }finally{client.release();}
    const session=await createSession(createdUser.id,req); setSessionCookie(rep,session.token);
    return rep.code(201).send({user:createdUser});
  });

  app.post('/api/auth/login',{config:{rateLimit:{max:5,timeWindow:'5 minutes'}}},async(req:any,rep)=>{
    const {email,password}=req.body||{}; const emailNorm=String(email||'').toLowerCase().trim();
    const r=await query(`SELECT * FROM usuarios WHERE email=$1 AND ativo=true`,[emailNorm]);
    if(!r.rowCount || !(await verifyPassword(r.rows[0].senha_hash,password||''))){ await audit(req,'LOGIN_FALHOU',false,null,{email:emailNorm}); return rep.code(401).send({message:'E-mail ou senha inválidos'}); }
    await query(`DELETE FROM sessoes WHERE expira_em<=NOW() OR revogado_em<NOW()-INTERVAL '30 days'`);
    await query(`DELETE FROM desafios_mfa_login WHERE expira_em<=NOW()`);
    if(r.rows[0].mfa_enabled){
      const challenge=randomToken(32);
      await query(`INSERT INTO desafios_mfa_login(usuario_id,token_hash,expira_em) VALUES($1,$2,NOW()+INTERVAL '5 minutes')`,[r.rows[0].id,sha256(challenge)]);
      await audit(req,'MFA_SOLICITADO',true,r.rows[0].id);
      return rep.code(202).send({mfa_required:true,challenge_token:challenge,user:{id:r.rows[0].id,email:r.rows[0].email,nome:r.rows[0].nome,moeda:r.rows[0].moeda,mascote_id:r.rows[0].mascote_id}});
    }
    await query(`UPDATE usuarios SET ultimo_acesso=now() WHERE id=$1`,[r.rows[0].id]);
    const session=await createSession(r.rows[0].id,req); setSessionCookie(rep,session.token);
    await audit(req,'LOGIN_REALIZADO',true,r.rows[0].id);
    return {user:{id:r.rows[0].id,email:r.rows[0].email,nome:r.rows[0].nome,moeda:r.rows[0].moeda,mascote_id:r.rows[0].mascote_id}};
  });

  app.post('/api/auth/mfa/verify',{config:{rateLimit:{max:8,timeWindow:'5 minutes'}}},async(req:any,rep)=>{
    const challenge=String(req.body?.challenge_token||''); const code=String(req.body?.code||'');
    if(!challenge||!code)return rep.code(400).send({message:'Código de autenticação obrigatório'});
    const r=await query(`SELECT d.id,d.usuario_id,d.tentativas,u.mfa_secret_enc,u.email,u.nome,u.moeda,u.mascote_id FROM desafios_mfa_login d JOIN usuarios u ON u.id=d.usuario_id WHERE d.token_hash=$1 AND d.expira_em>NOW() AND u.ativo=true`,[sha256(challenge)]);
    if(!r.rowCount)return rep.code(401).send({message:'Desafio expirado. Entre novamente.'});
    if(r.rows[0].tentativas>=5){await query(`DELETE FROM desafios_mfa_login WHERE id=$1`,[r.rows[0].id]);return rep.code(429).send({message:'Muitas tentativas. Entre novamente.'});}
    await query(`UPDATE desafios_mfa_login SET tentativas=tentativas+1 WHERE id=$1`,[r.rows[0].id]);
    let secret=''; try{secret=decryptSecret(r.rows[0].mfa_secret_enc||'')}catch{}
    if(!secret||!verifyTotp(secret,code))return rep.code(401).send({message:'Código de autenticação inválido'});
    await query(`DELETE FROM desafios_mfa_login WHERE id=$1`,[r.rows[0].id]);
    await query(`UPDATE usuarios SET ultimo_acesso=now() WHERE id=$1`,[r.rows[0].usuario_id]);
    const session=await createSession(r.rows[0].usuario_id,req); setSessionCookie(rep,session.token);
    await audit(req,'LOGIN_REALIZADO_MFA',true,r.rows[0].usuario_id);
    return {user:{id:r.rows[0].usuario_id,email:r.rows[0].email,nome:r.rows[0].nome,moeda:r.rows[0].moeda,mascote_id:r.rows[0].mascote_id}};
  });

  app.get('/api/auth/mfa',async(req:any)=>{const r=await query(`SELECT mfa_enabled,mfa_confirmado_em FROM usuarios WHERE id=$1`,[userId(req)]);return r.rows[0]});
  app.post('/api/auth/mfa/iniciar',{config:{rateLimit:{max:3,timeWindow:'10 minutes'}}},async(req:any,rep)=>{ const id=userId(req); const current=await query(`SELECT email,nome,mfa_enabled,senha_hash FROM usuarios WHERE id=$1`,[id]); if(current.rows[0]?.mfa_enabled)return rep.code(409).send({message:'A autenticação em dois fatores já está ativa.'}); if(!env.MFA_ENCRYPTION_KEY)return rep.code(503).send({message:'MFA ainda não foi configurado no servidor.'}); if(!(await verifyPassword(current.rows[0].senha_hash,String(req.body?.password||''))))return rep.code(401).send({message:'Senha atual inválida'}); const secret=base32Encode(crypto.randomBytes(20)); await query(`UPDATE usuarios SET mfa_secret_enc=$1 WHERE id=$2`,[encryptSecret(secret),id]); const label=encodeURIComponent(`Meu Controle:${current.rows[0].email}`); return {secret,otpauth:`otpauth://totp/${label}?secret=${secret}&issuer=Meu%20Controle`}; });
