import sharp from 'sharp';
import {z} from 'zod';
import {digest} from '../auth/security';
import {createHash} from 'node:crypto';
import {DomainError,requireCondition} from '../domain/errors';
export const maxImageBytes=5*1024*1024;
export const uploadMediaInput=z.object({requestId:z.string().uuid(),expectedVersion:z.number().int().positive(),fileName:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.(png|jpe?g|webp)$/i),base64:z.string().min(4).max(4*Math.ceil(maxImageBytes/3))}).strict();
export const bytesHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function imageBytes(base64:string){requireCondition(base64.length<=4*Math.ceil(maxImageBytes/3)&&base64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(base64),'MEDIA_ENCODING','Image must use canonical base64 within the 5 MB limit',400);const bytes=Buffer.from(base64,'base64');requireCondition(bytes.length>0&&bytes.length<=maxImageBytes&&bytes.toString('base64')===base64,'MEDIA_SIZE','Image must be between 1 byte and 5 MB',400);return bytes;}
export async function sanitizeImage(bytes:Buffer,fileName:string){
 requireCondition(process.env.DEMO_MODE==='true'&&(process.env.DOCUMENT_SCAN_MODE??'mock')==='mock','MEDIA_SCANNER_UNAVAILABLE','Only explicit local mock scanning is implemented; production scanning must be configured',503);
 requireCondition(bytes.length>0&&bytes.length<=maxImageBytes,'MEDIA_SIZE','Image exceeds the 5 MB input limit',400);
 requireCondition(!/EICAR-STANDARD-ANTIVIRUS-TEST-FILE|<script|\/JavaScript/i.test(bytes.toString('latin1')),'MEDIA_SCAN_BLOCKED','Deterministic mock scanner blocked this file',400);
 try{
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:4096*4096,animated:false}).timeout({seconds:5});const meta=await image.metadata();
  const ext=fileName.split('.').pop()!.toLowerCase(),format=ext==='jpg'?'jpeg':ext;
  requireCondition(['png','jpeg','webp'].includes(meta.format??'')&&meta.format===format,'MEDIA_TYPE','File extension must match a PNG, JPEG or WebP image',400);
  requireCondition((meta.pages??1)===1,'MEDIA_ANIMATION','Animated or multi-page images are not supported',400);
  requireCondition(meta.width&&meta.height&&meta.width>=128&&meta.height>=128&&meta.width<=4096&&meta.height<=4096,'MEDIA_DIMENSIONS','Use an image between 128 × 128 and 4096 × 4096 pixels',400);
  // Decode and re-encode pixels, stripping EXIF/location and other metadata. Never serve uploaded source bytes.
  const {data,info}=await image.rotate().png().toBuffer({resolveWithObject:true});requireCondition(data.length<=maxImageBytes,'MEDIA_SIZE','Sanitized image exceeds the 5 MB output limit',400);
  const samples=await sharp(data).resize(8,8,{fit:'fill'}).flatten({background:'#ffffff'}).removeAlpha().raw().toBuffer();
  let white=0,total=0;for(let y=0;y<8;y++)for(let x=0;x<8;x++)if(x===0||y===0||x===7||y===7){const i=(y*8+x)*3;total++;if(samples[i]>=240&&samples[i+1]>=240&&samples[i+2]>=240)white++;}
  return {bytes:data,contentType:'image/png' as const,byteSize:data.length,width:info.width,height:info.height,checksum:bytesHash(data),originalChecksum:bytesHash(bytes),scanStatus:'MOCK_CLEAN' as const,quality:{edgeWhitePercent:Math.round(100*white/total),backgroundAssessment:'HUMAN_REVIEW_REQUIRED' as const,scanner:'Deterministic local mock; not a production malware guarantee',metadataStripped:true}};
 }catch(e){if(e instanceof DomainError)throw e;throw new DomainError('MEDIA_DECODE','Image is corrupt, unsafe or exceeds the decoded pixel limit',400);}
}
export function mediaRequestHash(input:z.infer<typeof uploadMediaInput>){return digest(JSON.stringify(input));}
