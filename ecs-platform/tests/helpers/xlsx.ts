import {readFile} from 'node:fs/promises';
import {crc32,deflateRawSync} from 'node:zlib';
import {fromBufferPromise} from 'yauzl';
// Mutate OOXML in memory for adversarial parser tests. The positive workbook
// fixture is generated independently with the bundled spreadsheet authoring tool.
export async function workbookParts(){
 const zip=await fromBufferPromise(await readFile(new URL('../fixtures/catalogue.xlsx',import.meta.url)));
 const parts=new Map<string,string>();
 for await(const entry of zip.eachEntry()){
  const stream=await zip.openReadStreamPromise(entry),chunks:Buffer[]=[];
  for await(const chunk of stream)chunks.push(Buffer.from(chunk));
  parts.set(entry.fileName,Buffer.concat(chunks).toString('utf8').replaceAll('<x:','<').replaceAll('</x:','</').replaceAll('xmlns:x=','xmlns='));
 }return parts;
}
export function zipParts(parts:Map<string,string|Buffer>){
 const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
 for(const [path,value] of parts){
  const name=Buffer.from(path),data=Buffer.from(value),compressed=deflateRawSync(data),crc=crc32(data);
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
  const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(8,10);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
  local.push(header,name,compressed);central.push(directory,name);offset+=header.length+name.length+compressed.length;
 }
 const tail=Buffer.alloc(22);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(parts.size,8);tail.writeUInt16LE(parts.size,10);tail.writeUInt32LE(Buffer.concat(central).length,12);tail.writeUInt32LE(offset,16);
 return Buffer.concat([...local,...central,tail]).toString('base64');
}
export async function mutateWorkbook(change:(parts:Map<string,string>)=>void){const parts=await workbookParts();change(parts);return zipParts(parts);}
export function replaceCell(parts:Map<string,string>,reference:string,xml:string){
 const path='xl/worksheets/sheet1.xml',source=parts.get(path)!;
 const pattern=new RegExp(`<c\\b(?=[^>]*\\br="${reference}")[^>]*(?:/>|>[\\s\\S]*?</c>)`);
 if(!pattern.test(source))throw new Error(`Fixture cell ${reference} is missing`);
 parts.set(path,source.replace(pattern,xml));
}
