import {it,expect} from 'vitest';
import {parseMediaArchive,zipMediaInput} from '../../packages/media/archive';
import {zipParts} from '../helpers/xlsx';
const manifest=(files=['front.png'])=>JSON.stringify({version:1,images:files.map(file=>({file}))});
it('preserves explicit manifest order and original archive checksum without filesystem extraction',async()=>{
 const value=zipParts(new Map([['front.png','front'],['back.png','back'],['manifest.json',manifest(['back.png','front.png'])]]));
 const parsed=await parseMediaArchive(value);expect(parsed.images.map(i=>i.fileName)).toEqual(['back.png','front.png']);expect(parsed.images[0].bytes.toString()).toBe('back');expect(parsed.checksum).toMatch(/^[a-f0-9]{64}$/);
});
it('rejects paths, nested archives, duplicate case aliases, undeclared and missing imagery',async()=>{
 for(const files of [new Map([['../front.png','x'],['manifest.json',manifest()]]),new Map([['images/front.png','x'],['manifest.json',manifest()]]),new Map([['bad.zip','x'],['manifest.json',manifest()]]),new Map([['front.png','x'],['FRONT.PNG','x'],['manifest.json',manifest()]]),new Map([['front.png','x'],['other.jpg','x'],['manifest.json',manifest()]]),new Map([['manifest.json',manifest()]])])await expect(parseMediaArchive(zipParts(files))).rejects.toThrow();
 for(const text of ['{}','{"version":2,"images":[]}',manifest(['front.png','front.png'])])await expect(parseMediaArchive(zipParts(new Map([['manifest.json',text],['front.png','x']])))).rejects.toThrow();
});
it('rejects bad encodings, oversized expansion, bad CRC, encryption and symlinks',async()=>{
 for(const value of ['','!!!!','YQ==\n','YR=='])await expect(parseMediaArchive(value)).rejects.toThrow();
 await expect(parseMediaArchive(zipParts(new Map([['front.png','x'.repeat(6*1024*1024)],['manifest.json',manifest()]])))).rejects.toMatchObject({code:'MEDIA_ZIP_LIMIT'});
 const raw=Buffer.from(zipParts(new Map([['front.png','pixels'],['manifest.json',manifest()]])),'base64'),offset=raw.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));
 for(const mutate of [(b:Buffer)=>b.writeUInt32LE(123,offset+16),(b:Buffer)=>b.writeUInt16LE(1,offset+8),(b:Buffer)=>b.writeUInt32LE(0xa0000000,offset+38)]){const b=Buffer.from(raw);mutate(b);await expect(parseMediaArchive(b.toString('base64'))).rejects.toThrow();}
 expect(zipMediaInput.safeParse({requestId:crypto.randomUUID(),expectedVersion:1,fileName:'../bad.zip',base64:'UEs='}).success).toBe(false);
});
