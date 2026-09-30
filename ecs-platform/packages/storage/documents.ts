import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { S3Client,PutObjectCommand,GetObjectCommand,HeadBucketCommand } from '@aws-sdk/client-s3';
import { readEnv } from '../config/env';
import { requireCondition } from '../domain/errors';
import {getSupabaseObject,putSupabaseObject,supabaseStorageHealth} from './supabase';
export const maxDocumentBytes=5*1024*1024;
const base=()=>resolve('.local',process.env.NODE_ENV==='test'?'test-documents':'documents');
function objectPath(key:string){requireCondition(/^[a-f0-9-]{36}$/.test(key),'INVALID_OBJECT_KEY','Invalid private storage key');return join(base(),key);}
function s3(){return new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION??'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY??'',secretAccessKey:process.env.S3_SECRET_KEY??''}});}
const bucket=()=>process.env.S3_BUCKET??'ecs-documents';
export const checksum=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function scanDocument(bytes:Buffer,contentType:string){
  requireCondition(bytes.length>0&&bytes.length<=maxDocumentBytes,'FILE_SIZE','Document must be between 1 byte and 5 MB');
  requireCondition((process.env.DOCUMENT_SCAN_MODE??'mock')==='mock'&&readEnv().DEMO_MODE==='true','SCAN_UNAVAILABLE','A validated malware scanner is required outside the explicit local mock mode',503);
  const plain=bytes.toString('latin1');
  const valid=contentType==='application/pdf'?plain.startsWith('%PDF-')&&plain.includes('%%EOF'):contentType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):contentType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:contentType==='text/plain'?!bytes.includes(0)&&!/[<>]/.test(plain):false;
  requireCondition(valid,'FILE_TYPE','Allowed types: PDF, PNG, JPEG or plain-text demo evidence. File signature must match.');
  const rejected=/EICAR-STANDARD-ANTIVIRUS-TEST-FILE|\/JavaScript|\/JS\b|\/Launch\b|\/EmbeddedFile\b|<script/i.test(plain);
  return {status:rejected?'BLOCKED':'MOCK_CLEAN',detail:rejected?'Mock scanner rejected a test signature or active content.':'Deterministic mock scan only; not a production malware guarantee.'};
}
export async function putDocument(key:string,bytes:Buffer,contentType:string){
  readEnv();
  objectPath(key);const mode=process.env.DOCUMENT_STORAGE??'local';
  if(mode==='supabase'){await putSupabaseObject(key,bytes,contentType);return 'supabase';}
  if(mode==='s3'){await s3().send(new PutObjectCommand({Bucket:bucket(),Key:key,Body:bytes,ContentType:contentType,Metadata:{sha256:checksum(bytes)}}));return 's3';}
  requireCondition(mode==='local'&&readEnv().DEMO_MODE==='true','STORAGE_UNAVAILABLE','Private document storage is not configured',503);
  await mkdir(base(),{recursive:true,mode:0o700});await writeFile(objectPath(key),bytes,{mode:0o600,flag:'wx'});return 'local';
}
export async function getDocument(key:string,mode:string){
  objectPath(key);
  if(mode==='supabase')return getSupabaseObject(key);
  if(mode==='local')return readFile(objectPath(key));
  requireCondition(mode==='s3','DOCUMENT_NOT_STORED','This legacy metadata record has no stored file',409);
  const object=await s3().send(new GetObjectCommand({Bucket:bucket(),Key:key}));requireCondition(object.Body,'DOCUMENT_MISSING','Stored object is missing',404);return Buffer.from(await object.Body.transformToByteArray());
}
export async function storageHealth(){try{readEnv();if(process.env.DOCUMENT_STORAGE==='supabase')await supabaseStorageHealth();else if((process.env.DOCUMENT_STORAGE??'local')==='s3')await s3().send(new HeadBucketCommand({Bucket:bucket()}));else await mkdir(base(),{recursive:true,mode:0o700});return {status:'up',mode:process.env.DOCUMENT_STORAGE??'local',scanner:process.env.DOCUMENT_SCAN_MODE??'mock'};}catch{return {status:'down',mode:process.env.DOCUMENT_STORAGE??'local'};}}
export function documentSignature(userId:string,id:string,expires:string){return createHmac('sha256',readEnv().WEBHOOK_SECRET).update(`private-document\n${userId}\n${id}\n${expires}`).digest('hex');}
export function verifyDocumentSignature(userId:string,id:string,expires:string,signature:string){
  const n=Number(expires);requireCondition(Number.isSafeInteger(n)&&n>=Date.now()&&n<=Date.now()+65000,'DOWNLOAD_EXPIRED','Download link expired; request a new one',403);
  const expected=Buffer.from(documentSignature(userId,id,expires),'hex'),provided=Buffer.from(signature,'hex');requireCondition(provided.length===expected.length&&timingSafeEqual(provided,expected),'DOWNLOAD_SIGNATURE','Invalid download link',403);
}
