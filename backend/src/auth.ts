import argon2 from 'argon2';
import crypto from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { query } from './db.js';
import { env } from './config.js';

export async function hashPassword(password:string){ return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }); }
export async function verifyPassword(hash:string,password:string){ return argon2.verify(hash,password); }
export function randomToken(bytes=32){ return crypto.randomBytes(bytes).toString('base64url'); }
export function sha256(value:string){ return crypto.createHash('sha256').update(value).digest('hex'); }

export function setSessionCookie(reply:FastifyReply, token:string){
  reply.setCookie('mcf_session', token, {
    httpOnly:true, secure:env.COOKIE_SECURE, sameSite:env.COOKIE_SAME_SITE,
    path:'/', domain:env.COOKIE_DOMAIN, maxAge:env.SESSION_DAYS*86400
  });
}
export function clearSessionCookie(reply:FastifyReply){
  reply.clearCookie('mcf_session',{path:'/',domain:env.COOKIE_DOMAIN});
}

export async function createSession(userId:string, request:FastifyRequest){
  const token=randomToken(32);
  const csrf=randomToken(32);
  const tokenHash=sha256(token);
  const csrfHash=sha256(csrf);
  const expires=new Date(Date.now()+env.SESSION_DAYS*86400000);
  await query(`INSERT INTO sessoes (usuario_id,token_hash,csrf_token_hash,expira_em,user_agent,ip) VALUES ($1,$2,$3,$4,$5,$6)`,[userId,tokenHash,csrfHash,expires,request.headers['user-agent']?.slice(0,500)??null,request.ip??null]);
  return {token,csrf};
}

export async function authenticate(request:FastifyRequest, reply:FastifyReply){
  const token=request.cookies?.mcf_session;
  if(!token) throw new Error('UNAUTHORIZED');
  const r=await query(`SELECT s.id,s.usuario_id,s.csrf_token_hash FROM sessoes s JOIN usuarios u ON u.id=s.usuario_id WHERE s.token_hash=$1 AND s.revogado_em IS NULL AND s.expira_em>NOW() AND u.ativo=true`,[sha256(token)]);
  if(!r.rowCount){ clearSessionCookie(reply); throw new Error('UNAUTHORIZED'); }
  await query(`UPDATE sessoes SET ultimo_acesso=NOW() WHERE id=$1`,[r.rows[0].id]);
  (request as any).sessionId=r.rows[0].id;
  (request as any).userId=r.rows[0].usuario_id;
  (request as any).csrfHash=r.rows[0].csrf_token_hash;
  return r.rows[0].usuario_id as string;
}

export async function requireCsrf(request:FastifyRequest){
  if(['GET','HEAD','OPTIONS'].includes(request.method)) return;
  const supplied=String(request.headers['x-csrf-token']??'');
  const expected=(request as any).csrfHash as string|undefined;
  if(!supplied || !expected || sha256(supplied)!==expected) throw new Error('CSRF_INVALID');
}


export function encryptSecret(secret:string){
  if(!/^[0-9a-fA-F]{64}$/.test(env.MFA_ENCRYPTION_KEY)) throw new Error('MFA_ENCRYPTION_KEY_INVALID');
  const key=Buffer.from(env.MFA_ENCRYPTION_KEY,'hex');
  const iv=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}
export function decryptSecret(payload:string){
  if(!/^[0-9a-fA-F]{64}$/.test(env.MFA_ENCRYPTION_KEY)) throw new Error('MFA_ENCRYPTION_KEY_INVALID');
  const [ivB,tagB,dataB]=String(payload).split('.');
  const key=Buffer.from(env.MFA_ENCRYPTION_KEY,'hex');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(ivB,'base64url'));
  decipher.setAuthTag(Buffer.from(tagB,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB,'base64url')),decipher.final()]).toString('utf8');
}
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(input:Buffer){
  let bits=0, value=0, out='';
  for(const byte of input){ value=(value<<8)|byte; bits+=8; while(bits>=5){bits-=5;out+=B32[(value>>bits)&31];} }
  if(bits>0) out+=B32[(value<<(5-bits))&31];
  return out;
}
export function base32Decode(input:string){
  const clean=input.replace(/=+$/,'').toUpperCase(); let bits=0,value=0; const out:number[]=[];
  for(const ch of clean){const idx=B32.indexOf(ch);if(idx<0)throw new Error('INVALID_BASE32');value=(value<<5)|idx;bits+=5;if(bits>=8){bits-=8;out.push((value>>bits)&255);}}
  return Buffer.from(out);
}
export function totp(secret:string, timestamp=Date.now()){
  const counter=Math.floor(timestamp/1000/30);
  const buf=Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const mac=crypto.createHmac('sha1',base32Decode(secret)).update(buf).digest();
  const offset=mac[mac.length-1]&15;
  const code=((mac[offset]&127)<<24|(mac[offset+1]&255)<<16|(mac[offset+2]&255)<<8|(mac[offset+3]&255))%1000000;
  return String(code).padStart(6,'0');
}
export function verifyTotp(secret:string,code:string){
  const clean=String(code||'').replace(/\s/g,''); if(!/^\d{6}$/.test(clean)) return false;
  for(const delta of [-30000,0,30000]) if(totp(secret,Date.now()+delta)===clean) return true;
  return false;
}
