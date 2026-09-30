import {describe,it,expect} from 'vitest';
import {parseCatalogCsv,importFields,titleSimilarity,importRequest,importReportCsv} from '../../packages/domain/catalog-import';
const headers=importFields.slice(0,16).join(',');
const row=['VND-LUM','Lumera','NEW-SKU','0629110000012','NEW-PARENT','A title','عنوان','Beauty/Makeup/Lips','Coral','One Size','160','145','AED','/demo-assets/lum-lip-ruby.svg','LUM-DXB-WH01','0'];
describe('catalogue CSV staging parser',()=>{
 it('preserves leading GTIN zeros, Arabic and quoted commas',()=>{
  const values=[...row];values[5]='"A title, with comma"';const parsed=parseCatalogCsv('\ufeff'+headers+'\r\n'+values.join(',')+'\r\n');
  expect(parsed[0]).toMatchObject({gtin:'0629110000012',title_ar:'عنوان',title_en:'A title, with comma',quantity:'0'});
 });
 it('rejects malformed headers, duplicate headers, unknown headers, ragged rows and empty files',()=>{
  for(const content of ['',headers,headers+',brand\n'+row.join(',')+',Lumera',headers+',__proto__\n'+row.join(',')+',value',headers+'\nonly,two',headers+'\n"unclosed'])expect(()=>parseCatalogCsv(content)).toThrow();
 });
 it('enforces row/byte/field caps without evaluating spreadsheet formulas',()=>{
  expect(()=>parseCatalogCsv(headers+'\n'+Array(101).fill(row.join(',')).join('\n'))).toThrow('100');
  expect(()=>parseCatalogCsv('x'.repeat(262145))).toThrow('256 KB');
  const copy=[...row];copy[5]='=1+1';expect(parseCatalogCsv(headers+'\n'+copy.join(','))[0].title_en).toBe('=1+1');
  copy[5]='x'.repeat(501);expect(()=>parseCatalogCsv(headers+'\n'+copy.join(','))).toThrow();
 });
 it('scores normalized title similarity and rejects client-supplied workflow status',()=>{
  expect(titleSimilarity('Lumera, velvet lip colour','LUMERA Velvet Lip Colour')).toBe(1);
  expect(titleSimilarity('','')).toBe(0);
  expect(importRequest.safeParse({source:'API',fileName:'API batch',requestKey:'b62eb9b9-1363-4ac3-98e9-719d4ff5357d',rows:[{status:'PUBLISHED'}]}).success).toBe(false);
 });
 it('escapes formula-like imported values in validation report downloads',()=>{
  const csv=importReportCsv([{number:2,input:{vendor_sku:'=HYPERLINK("unsafe")'},issues:[{code:'SKU_INVALID',field:'vendor_sku',message:'Use a valid SKU'}]}]);
  expect(csv).toContain('"\'=HYPERLINK(""unsafe"")"');expect(csv).toContain('SKU_INVALID');
 });
});
