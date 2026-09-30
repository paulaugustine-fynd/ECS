import {it,expect,vi,afterEach} from 'vitest';
import sharp from 'sharp';
import {imageBytes,sanitizeImage,uploadMediaInput,maxImageBytes} from '../../packages/media/image';
import {mediaAssetResponse} from '../../packages/contracts/media-responses';
afterEach(()=>vi.unstubAllEnvs());
const raster=(width=256,height=256)=>sharp({create:{width,height,channels:3,background:'#ffffff'}});
it('decodes real pixels, strips metadata and records explicit human/mock quality boundaries',async()=>{
 const raw=await raster().withMetadata().png().toBuffer(),asset=await sanitizeImage(raw,'catalogue.png'),meta=await sharp(asset.bytes).metadata();
 expect(asset).toMatchObject({width:256,height:256,scanStatus:'MOCK_CLEAN',quality:{edgeWhitePercent:100,backgroundAssessment:'HUMAN_REVIEW_REQUIRED',metadataStripped:true}});expect(meta.exif).toBeUndefined();expect(meta.icc).toBeUndefined();expect(asset.checksum).not.toBe(asset.originalChecksum);
 expect(mediaAssetResponse.safeParse({...asset,id:'x',companyId:'x',partnerId:'x',market:'AE',createdAt:new Date().toISOString()}).success).toBe(false); // byte buffers must never leak through metadata DTOs.
});
it('rejects noncanonical, empty and oversized inputs and unsafe filenames',()=>{
 for(const raw of ['','!!!!','YQ=','YQ==\n','YQ===','YR==','A'.repeat(4*Math.ceil(maxImageBytes/3)+4)])expect(()=>imageBytes(raw)).toThrow();
 for(const fileName of ['../image.png','/image.png','image.svg','image.png.exe','image\\test.png'])expect(uploadMediaInput.safeParse({requestId:crypto.randomUUID(),expectedVersion:1,fileName,base64:'YQ=='}).success).toBe(false);
});
it('rejects SVG, disguised files, malformed raster images, dimensions and mock malware signatures',async()=>{
 const png=await raster().png().toBuffer();await expect(sanitizeImage(png,'wrong.jpg')).rejects.toMatchObject({code:'MEDIA_TYPE'});
 for(const raw of [Buffer.from('<svg><script/></svg>'),Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'),png.subarray(0,40)])await expect(sanitizeImage(raw,'bad.png')).rejects.toThrow();
 for(const dims of [[127,128],[128,4097]])await expect(sanitizeImage(await raster(...dims as [number,number]).png().toBuffer(),'dimensions.png')).rejects.toMatchObject({code:'MEDIA_DIMENSIONS'});
});
it('fails closed when a production scanner is requested',async()=>{vi.stubEnv('DOCUMENT_SCAN_MODE','live');await expect(sanitizeImage(await raster().png().toBuffer(),'image.png')).rejects.toMatchObject({code:'MEDIA_SCANNER_UNAVAILABLE'});});
