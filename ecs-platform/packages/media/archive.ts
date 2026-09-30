import {fromBuffer,type Entry,type ZipFile} from 'yauzl';
import type {Readable} from 'node:stream';
import {crc32} from 'node:zlib';
import {z} from 'zod';
import {DomainError,requireCondition} from '../domain/errors';
import {bytesHash,maxImageBytes} from './image';
export const maxArchiveBytes=10*1024*1024;
const imageName=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.(png|jpe?g|webp)$/i);
export const mediaManifest=z.object({version:z.literal(1),images:z.array(z.object({file:imageName}).strict()).min(1).max(10)}).strict();
export const zipMediaInput=z.object({requestId:z.string().uuid(),expectedVersion:z.number().int().positive(),fileName:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,100}\.zip$/i),base64:z.string().min(4).max(4*Math.ceil(maxArchiveBytes/3))}).strict();
const invalid=()=>new DomainError('MEDIA_ZIP_INVALID','Use a valid unencrypted ZIP with manifest.json and the declared raster images only',400);
export function archiveBytes(base64:string){
 requireCondition(base64.length<=4*Math.ceil(maxArchiveBytes/3)&&base64.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(base64),'MEDIA_ZIP_ENCODING','ZIP must use canonical base64 within 10 MB',400);
 const bytes=Buffer.from(base64,'base64');requireCondition(bytes.length>0&&bytes.length<=maxArchiveBytes&&bytes.toString('base64')===base64,'MEDIA_ZIP_SIZE','ZIP exceeds 10 MB or uses invalid encoding',400);
 return bytes;
}
export async function parseMediaArchive(base64:string){
 const bytes=archiveBytes(base64);
 const files=await new Promise<Map<string,Buffer>>((resolve,reject)=>{
  let zip:ZipFile|undefined,stream:Readable|undefined,done=false,total=0,count=0;const entries=new Map<string,Buffer>(),names=new Set<string>();
  const finish=(error?:unknown)=>{if(done)return;done=true;clearTimeout(timer);stream?.destroy();zip?.close();if(error)reject(error instanceof DomainError?error:invalid());else resolve(entries);};
  const timer=setTimeout(()=>finish(new DomainError('MEDIA_ZIP_TIMEOUT','ZIP extraction exceeded five seconds',400)),5000);
  fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,opened)=>{
   if(done){opened?.close();return;}if(error||!opened){finish(error??invalid());return;}zip=opened;
   zip.on('error',finish);zip.on('end',()=>finish());
   zip.on('entry',(entry:Entry)=>{
    try{
     const name=entry.fileName,limit=name==='manifest.json'?16384:maxImageBytes,type=(entry.externalFileAttributes>>>16)&0xf000;
     requireCondition(++count<=11&&!names.has(name.toLowerCase())&&(name==='manifest.json'||imageName.safeParse(name).success),'MEDIA_ZIP_ENTRIES','ZIP allows one manifest and up to ten uniquely named root-level PNG/JPEG/WebP files only',400);
     requireCondition(!(entry.generalPurposeBitFlag&1)&&[0,8].includes(entry.compressionMethod)&&(type===0||type===0x8000),'MEDIA_ZIP_UNSAFE','Encrypted, linked, special or unsupported ZIP entries are rejected',400);
     requireCondition(entry.uncompressedSize>0&&entry.uncompressedSize<=limit&&total+entry.uncompressedSize<=20*1024*1024&&entry.uncompressedSize<=Math.max(entry.compressedSize,1)*200,'MEDIA_ZIP_LIMIT','ZIP exceeds per-file, 20 MB expanded or 200:1 compression limits',413);
     names.add(name.toLowerCase());
     zip!.openReadStream(entry,(err,openedStream)=>{
      if(done){openedStream?.destroy();return;}if(err||!openedStream){finish(err??invalid());return;}stream=openedStream;const chunks:Buffer[]=[];let size=0;
      stream.on('error',finish);stream.on('data',(chunk:Buffer)=>{if(done)return;size+=chunk.length;total+=chunk.length;if(size>limit||total>20*1024*1024){finish(new DomainError('MEDIA_ZIP_LIMIT','Expanded ZIP exceeds allowed size',413));return;}chunks.push(chunk);});
      stream.on('end',()=>{if(done)return;try{const data=Buffer.concat(chunks);requireCondition(size===entry.uncompressedSize&&crc32(data)===entry.crc32,'MEDIA_ZIP_CHECKSUM','ZIP entry size or CRC does not match',400);entries.set(name,data);zip!.readEntry();}catch(e){finish(e);}});
     });
    }catch(e){finish(e);}
   });zip.readEntry();
  });
 });
 let manifest:z.infer<typeof mediaManifest>;
 try{manifest=mediaManifest.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(files.get('manifest.json'))));}catch{throw new DomainError('MEDIA_ZIP_MANIFEST','manifest.json must contain version 1 and an images array of file names',400);}
 requireCondition(new Set(manifest.images.map(i=>i.file.toLowerCase())).size===manifest.images.length&&files.size===manifest.images.length+1&&manifest.images.every(i=>files.has(i.file)),'MEDIA_ZIP_MANIFEST','Every image must be listed exactly once; missing or undeclared files are rejected',400);
 return {checksum:bytesHash(bytes),manifest,images:manifest.images.map(i=>({fileName:i.file,bytes:files.get(i.file)!}))};
}
