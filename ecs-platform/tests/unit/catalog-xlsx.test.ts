import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {parseCatalogXlsx} from '../../packages/domain/catalog-xlsx';
import {importFields,importRequest} from '../../packages/domain/catalog-import';
import {mutateWorkbook,replaceCell,zipParts} from '../helpers/xlsx';
const parse=(base64:string)=>parseCatalogXlsx(base64,importFields,importFields.slice(0,16));
describe('bounded data-only XLSX catalogue ingestion',()=>{
 it('reads an independently generated workbook without losing GTIN zeros, Arabic or typed prices',async()=>{
  const rows=await parse((await readFile(new URL('../fixtures/catalogue.xlsx',import.meta.url))).toString('base64'));
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({partner_code:'VND-LUM',gtin:'06299920000014',title_ar:'أحمر شفاه مرجاني مخملي',quantity:'12',selling_price:'145'});
 });
 it('supports shared strings and literal entities without evaluating them',async()=>{
  const content=await mutateWorkbook(parts=>{
   parts.set('xl/sharedStrings.xml','<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Velvet &amp; Coral</t></si></sst>');
   replaceCell(parts,'F2','<c r="F2" t="s"><v>0</v></c>');
  });expect((await parse(content))[0].title_en).toBe('Velvet & Coral');
 });
 it('rejects numeric identifiers and formula caches rather than treating them as authoritative',async()=>{
  await expect(parse(await mutateWorkbook(p=>replaceCell(p,'D2','<c r="D2"><v>6299920000014</v></c>')))).rejects.toMatchObject({code:'XLSX_TEXT_REQUIRED'});
  await expect(parse(await mutateWorkbook(p=>replaceCell(p,'L2','<c r="L2"><f>100+45</f><v>145</v></c>')))).rejects.toMatchObject({code:'XLSX_FORMULA'});
 });
 it('rejects hidden sheets, rows, merged cells and ambiguous extra sheets',async()=>{
  const path='xl/worksheets/sheet1.xml';
  for(const transform of [(s:string)=>s.replace('<sheetData>','<mergeCells><mergeCell ref="A2:B2"/></mergeCells><sheetData>'),(s:string)=>s.replace('<row r="2"','<row hidden="1" r="2"')])await expect(parse(await mutateWorkbook(p=>p.set(path,transform(p.get(path)!))))).rejects.toThrow();
  for(const transform of [(s:string)=>s.replace('name="Catalogue"','name="Catalogue" state="hidden"'),(s:string)=>s.replace('</sheets>','<sheet name="Other" sheetId="2" r:id="rId2"/></sheets>')])await expect(parse(await mutateWorkbook(p=>p.set('xl/workbook.xml',transform(p.get('xl/workbook.xml')!))))).rejects.toMatchObject({code:'XLSX_SHEETS'});
 });
 it('rejects bad headers, out-of-range cells, errors and empty template batches',async()=>{
  for(const [ref,cell] of [['A1','<c r="A1" t="inlineStr"><is><t>__proto__</t></is></c>'],['L2','<c r="L2" t="e"><v>#VALUE!</v></c>'],['P2','<c r="XFD2"><v>3</v></c>']])await expect(parse(await mutateWorkbook(p=>replaceCell(p,ref,cell)))).rejects.toThrow();
  const template=await readFile(new URL('../../apps/web/public/templates/ecs-catalogue-template.xlsx',import.meta.url));
  await expect(parse(template.toString('base64'))).rejects.toMatchObject({code:'XLSX_ROW_LIMIT'});
 });
 it('rejects malformed, oversized, entity-bearing and active-content archives',async()=>{
  await expect(parse('not base64')).rejects.toMatchObject({code:'XLSX_INVALID'});
  await expect(parse(Buffer.alloc(262145).toString('base64'))).rejects.toMatchObject({code:'IMPORT_TOO_LARGE'});
  await expect(parse(zipParts(new Map([['huge.xml','x'.repeat(1024*1024+1)]])))).rejects.toMatchObject({code:'XLSX_TOO_COMPLEX'});
  for(const [path,value] of [['xl/vbaProject.bin','macro'],['xl/embeddings/object.bin','object'],['extra.xml','<!DOCTYPE test [<!ENTITY x "expanded">]><test>&x;</test>']])await expect(parse(await mutateWorkbook(p=>p.set(path,value)))).rejects.toMatchObject({code:'XLSX_ACTIVE_CONTENT'});
  await expect(parse(await mutateWorkbook(p=>p.set('_rels/.rels','<Relationships><Relationship Id="unsafe" TargetMode="External" Target="https://example.invalid"/></Relationships>')))).rejects.toMatchObject({code:'XLSX_ACTIVE_CONTENT'});
 });
 it('accepts only the explicit XLSX request variant and safe filenames',()=>{
  const payload={source:'XLSX',fileName:'catalogue.xlsx',base64:'UEs=',requestKey:'b62eb9b9-1363-4ac3-98e9-719d4ff5357d'};
  expect(importRequest.safeParse(payload).success).toBe(true);
  for(const fileName of ['../data.xlsx','macro.xlsm','legacy.xls','data\n.xlsx'])expect(importRequest.safeParse({...payload,fileName}).success).toBe(false);
 });
 it('does not misread dates or percentages as numeric catalogue prices',async()=>{
  for(const numFmtId of ['14','9']){
   const content=await mutateWorkbook(p=>{
    p.set('xl/styles.xml',`<styleSheet><cellXfs><xf numFmtId="${numFmtId}"/></cellXfs></styleSheet>`);
    replaceCell(p,'K2','<c r="K2" s="0"><v>45000</v></c>');
   });await expect(parse(content)).rejects.toMatchObject({code:'XLSX_NUMBER_FORMAT'});
  }
 });
});
