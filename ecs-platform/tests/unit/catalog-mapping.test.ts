import {it,expect} from 'vitest';
import {mapCatalogSource,fieldMapping} from '../../packages/domain/catalog-mapping';
import {parseCatalogCsv,importFields} from '../../packages/domain/catalog-import';
import {parseCatalogXlsx} from '../../packages/domain/catalog-xlsx';
import {mutateWorkbook,replaceCell} from '../helpers/xlsx';
const fields=Object.fromEntries(importFields.map(f=>[f,f==='colour'?'shade':f]));
const row=Object.fromEntries(importFields.map(f=>[fields[f],f==='colour'?' Midnight ':f==='gtin'?'0012345678905':f==='title_ar'?'فستان':f]));
it('previews exact source mapping without losing raw values, leading zeros or Arabic',()=>{
 const result=mapCatalogSource([row],{fields,ignoredHeaders:[],values:[{field:'colour',from:'Midnight',to:'Black'}]});
 expect(result.ready).toBe(true);expect(result.sampleRows[0].raw.shade).toBe(' Midnight ');expect(result.canonicalRows[0]).toMatchObject({colour:'Black',gtin:'0012345678905',title_ar:'فستان'});
 expect(result.mapping.fields.colour).toBe('shade');
});
it('requires explicit handling of every source column and each required target',()=>{
 const result=mapCatalogSource([{...row,notes:'private note'}]);expect(result.ready).toBe(false);expect(result.missingFields).toContain('colour');expect(result.unmappedHeaders).toEqual(['shade','notes']);
 expect(mapCatalogSource([{...row,notes:'private note'}],{fields,ignoredHeaders:['notes'],values:[]}).ready).toBe(true);
 for(const mapping of [{fields:{...fields,size:'shade'},ignoredHeaders:[],values:[]},{fields,ignoredHeaders:['shade'],values:[]},{fields:{...fields,size:'absent'},ignoredHeaders:[],values:[]}])expect(()=>mapCatalogSource([row],mapping)).toThrow();
});
it('rejects dangerous headers, unknown targets and ambiguous value rules',()=>{
 for(const header of ['__proto__','constructor','prototype','bad\u0000header','x'.repeat(81)])expect(()=>mapCatalogSource([{[header]:'value'}])).toThrow();
 expect(fieldMapping.safeParse({fields:{status:'state'},ignoredHeaders:[],values:[]}).success).toBe(false);
 const rule={field:'colour' as const,from:'Midnight',to:'Black'};expect(()=>mapCatalogSource([row],{fields,ignoredHeaders:[],values:[rule,{...rule,to:'Blue'}]})).toThrow();
 expect(()=>mapCatalogSource([row],{fields,ignoredHeaders:[],values:[{field:'currency',from:'USD',to:'AED'}]})).toThrow('cannot convert');
 expect(mapCatalogSource([row],{fields,ignoredHeaders:[],values:[rule,{field:'colour',from:'Black',to:'Blue'}]}).canonicalRows[0].colour).toBe('Black');
 expect(()=>parseCatalogCsv('shade,notes\nBlack,hello',false)).toThrow();expect(parseCatalogCsv('shade,notes\nBlack,hello',true)).toEqual([{shade:'Black',notes:'hello'}]);
});
it('discovers custom XLSX headers but blocks numeric identifiers after mapping',async()=>{
 const base64=await mutateWorkbook(p=>{replaceCell(p,'I1','<c r="I1" t="inlineStr"><is><t>shade</t></is></c>');replaceCell(p,'D1','<c r="D1" t="inlineStr"><is><t>Barcode</t></is></c>');replaceCell(p,'D2','<c r="D2"><v>6299920000014</v></c>');});
 const numericHeaders=new Set<string>(),rows=await parseCatalogXlsx(base64,importFields,importFields.slice(0,16),{numericHeaders});
 const mapping={fields:{...Object.fromEntries(Object.keys(rows[0]).filter(h=>h!=='shade'&&h!=='Barcode').map(h=>[h,h])),colour:'shade',gtin:'Barcode'},ignoredHeaders:[],values:[]};
 const preview=mapCatalogSource(rows,mapping,[...numericHeaders]);expect(preview.numericIssues).toEqual(['Barcode']);expect(preview.ready).toBe(false);
 await expect(parseCatalogXlsx(await mutateWorkbook(p=>replaceCell(p,'L2','<c r="L2"><f>1+1</f><v>2</v></c>')),importFields,[],{numericHeaders:new Set()})).rejects.toMatchObject({code:'XLSX_FORMULA'});
});
