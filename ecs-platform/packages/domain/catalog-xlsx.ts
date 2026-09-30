import {fromBuffer,type Entry,type ZipFile} from 'yauzl';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {DomainError,requireCondition} from './errors';
import {checkSourceHeaders} from './catalog-mapping';

export const xlsxMaxBytes=262144;
const maxExpanded=4*1024*1024,maxEntry=1024*1024;
type Node=Record<string,unknown>;
const object=(value:unknown):Node=>value&&typeof value==='object'&&!Array.isArray(value)?value as Node:{};
const many=(value:unknown):unknown[]=>value===undefined?[]:Array.isArray(value)?value:[value];
const scalar=(value:unknown):string=>typeof value==='string'?value:typeof value==='number'?String(value):typeof object(value)['#text']==='string'?object(value)['#text'] as string:'';
const invalid=(message:string,code='XLSX_INVALID')=>new DomainError(code,message,400);

// Decompress serially with both declared and measured limits. No files are
// extracted and no workbook relationships are fetched from the network.
async function archive(bytes:Buffer):Promise<Map<string,string>>{
 return new Promise((resolve,reject)=>{
  let zip:ZipFile|undefined,finished=false,total=0,count=0;
  const files=new Map<string,string>();
  const fail=(error:unknown)=>{if(finished)return;finished=true;zip?.close();reject(error instanceof DomainError?error:invalid('Invalid or encrypted XLSX archive. Save a new .xlsx copy using the template.'));};
  fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(error,opened)=>{
   if(error||!opened){fail(error);return;}zip=opened;
   zip.on('error',fail);zip.on('end',()=>{if(!finished){finished=true;resolve(files);}});
   zip.on('entry',(entry:Entry)=>{
    if(finished)return;
    try{
     requireCondition(++count<=64&&entry.uncompressedSize<=maxEntry&&total+entry.uncompressedSize<=maxExpanded,'XLSX_TOO_COMPLEX','Workbook exceeds the supported archive limits',413);
     requireCondition(!files.has(entry.fileName),'XLSX_INVALID','Duplicate archive entries are not allowed',400);
     requireCondition(!(entry.generalPurposeBitFlag&1),'XLSX_INVALID','Encrypted workbooks are not supported',400);
     requireCondition(!/(?:vba|externalLinks|embeddings|activeX)/i.test(entry.fileName),'XLSX_ACTIVE_CONTENT','Macros, external links and embedded objects are not supported',400);
     if(entry.fileName.endsWith('/')){zip!.readEntry();return;}
     requireCondition(/\.(?:xml|rels)$/.test(entry.fileName),'XLSX_ACTIVE_CONTENT','Use a data-only workbook without binary attachments',400);
     zip!.openReadStream(entry,(err,stream)=>{
      if(err||!stream){fail(err);return;}
      const chunks:Buffer[]=[];let size=0;
      stream.on('error',fail);
      stream.on('data',(chunk:Buffer)=>{size+=chunk.length;total+=chunk.length;if(size>maxEntry||total>maxExpanded){stream.destroy();fail(new DomainError('XLSX_TOO_COMPLEX','Expanded workbook exceeds the supported size',413));return;}chunks.push(chunk);});
      stream.on('end',()=>{
       if(finished)return;
       try{
        const xml=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
        requireCondition(!/<!DOCTYPE|<!ENTITY/i.test(xml),'XLSX_ACTIVE_CONTENT','XML entity definitions are not allowed',400);
        files.set(entry.fileName,xml);zip!.readEntry();
       }catch(e){fail(e);}
      });
     });
    }catch(e){fail(e);}
   });zip.readEntry();
  });
 });
}
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,trimValues:false,ignoreDeclaration:true,maxNestedTags:32});
function xml(files:Map<string,string>,path:string){
 const source=files.get(path);requireCondition(source,'XLSX_INVALID',`Workbook part is missing: ${path}`,400);
 requireCondition(XMLValidator.validate(source)===true,'XLSX_INVALID','Workbook contains malformed XML',400);
 return object(parser.parse(source));
}
function rich(value:unknown){const node=object(value);return node.r===undefined?scalar(node.t):many(node.r).map(r=>scalar(object(r).t)).join('');}
export async function parseCatalogXlsx(base64:string,fields:readonly string[],required:readonly string[],inspection?:{numericHeaders:Set<string>}):Promise<Record<string,string>[]>{
 requireCondition(base64.length<=4*Math.ceil(xlsxMaxBytes/3),'IMPORT_TOO_LARGE','XLSX exceeds 256 KB',413);
 requireCondition(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)&&base64.length>0,'XLSX_INVALID','Invalid base64 workbook data',400);
 const bytes=Buffer.from(base64,'base64');requireCondition(bytes.length<=xlsxMaxBytes,'IMPORT_TOO_LARGE','XLSX exceeds 256 KB',413);
 requireCondition(bytes.toString('base64')===base64,'XLSX_INVALID','Non-canonical workbook encoding',400);
 try{
  const files=await archive(bytes);
  for(const [path] of files)if(path.endsWith('.rels')){
   for(const r of many(object(xml(files,path).Relationships).Relationship))requireCondition(object(r)['@_TargetMode']!=='External','XLSX_ACTIVE_CONTENT','External links are not supported. Paste values into the template.',400);
  }
  const sheets=many(object(object(xml(files,'xl/workbook.xml').workbook).sheets).sheet);
  requireCondition(sheets.length===1,'XLSX_SHEETS','Use one visible worksheet named Catalogue',400);
  const sheet=object(sheets[0]);requireCondition(sheet['@_name']==='Catalogue'&&(!sheet['@_state']||sheet['@_state']==='visible'),'XLSX_SHEETS','Use one visible worksheet named Catalogue',400);
  const rels=many(object(xml(files,'xl/_rels/workbook.xml.rels').Relationships).Relationship).map(object);
  const rel=rels.find(r=>r['@_Id']===sheet['@_id']);const target=String(rel?.['@_Target']??'');
  requireCondition(/^\/?(?:xl\/)?worksheets\/[^/]+\.xml$/.test(target),'XLSX_INVALID','Worksheet relationship is invalid',400);
  const path=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:`xl/${target}`;
  const worksheet=object(xml(files,path).worksheet);
  requireCondition(!worksheet.mergeCells,'XLSX_MERGED_CELLS','Unmerge cells before importing',400);
  requireCondition(!many(object(worksheet.cols).col).some(c=>['1','true'].includes(String(object(c)['@_hidden']))),'XLSX_HIDDEN_COLUMN','Unhide columns before importing',400);
  const strings=files.has('xl/sharedStrings.xml')?many(object(xml(files,'xl/sharedStrings.xml').sst).si).map(rich):[];
  requireCondition(strings.length<=5000&&strings.every(s=>s.length<=500),'XLSX_TOO_COMPLEX','Shared strings exceed the supported limits',400);
  const styles=files.has('xl/styles.xml')?object(xml(files,'xl/styles.xml').styleSheet):{};
  const formats=new Map(many(object(styles.numFmts).numFmt).map(v=>{const f=object(v);return [String(f['@_numFmtId']),String(f['@_formatCode'])];}));
  const cellStyles=many(object(styles.cellXfs).xf).map(object);
  const rows=many(object(worksheet.sheetData).row);requireCondition(rows.length<=101,'XLSX_ROW_LIMIT','Use the header plus at most 100 product rows',400);
  const headers:string[]=[],result:Record<string,string>[]=[];
  for(const item of rows){
   const row=object(item),rowNumber=Number(row['@_r']),cells=many(row.c).map(object);
   requireCondition(Number.isInteger(rowNumber)&&rowNumber>=1&&rowNumber<=101,'XLSX_ROW_LIMIT','Product rows must be within rows 2–101',400);
   requireCondition(!['1','true'].includes(String(row['@_hidden'])),'XLSX_HIDDEN_ROW',`Unhide row ${rowNumber} before importing`,400);
   requireCondition(cells.length<=(inspection?50:fields.length),'XLSX_HEADERS','Workbook has too many columns',400);
   const values=new Map<number,string>();
   for(const cell of cells){
    const reference=String(cell['@_r']??''),match=/^([A-Z]{1,2})([1-9]\d*)$/.exec(reference);
    requireCondition(match&&Number(match[2])===rowNumber,'XLSX_INVALID','Invalid cell reference',400);
    const column=[...match[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
    requireCondition(column<(inspection?50:fields.length)&&!values.has(column),'XLSX_HEADERS','Unknown or duplicate cell column',400);
    requireCondition(!Object.hasOwn(cell,'f'),'XLSX_FORMULA',`${reference}: formulas are not accepted. Paste values before uploading.`,400);
    const type=cell['@_t'];let value='';
    if(type==='s'){
     const index=scalar(cell.v);requireCondition(/^\d+$/.test(index)&&Number(index)<strings.length,'XLSX_INVALID','Invalid shared string reference',400);value=strings[Number(index)];
    }else if(type==='inlineStr')value=rich(cell.is);
    else if(type==='str')value=scalar(cell.v);
    else if(type===undefined||type==='n'){
     value=scalar(cell.v);
     if(value!==''){
      requireCondition(rowNumber>1&&(!!inspection||['quantity','list_price','selling_price'].includes(headers[column])),'XLSX_TEXT_REQUIRED',`${reference}: ${headers[column]??'headers'} must be stored as text. GTINs and SKUs must retain leading zeros.`,400);
      if(inspection)inspection.numericHeaders.add(headers[column]);
      const style=cell['@_s'],index=Number(style??0),format=style===undefined?'0':String(cellStyles[index]?.['@_numFmtId']??'invalid');
      requireCondition(Number.isInteger(index)&&(['0','1','2','3','4'].includes(format)||['0','0.00','#,##0','#,##0.00','General'].includes(formats.get(format)??'')),'XLSX_NUMBER_FORMAT',`${reference}: use General or plain Number formatting, not dates, percentages or currencies.`,400);
     }
    }else throw invalid(`${reference}: use plain text or numeric prices/quantities, not dates, booleans or errors.`,'XLSX_CELL_TYPE');
    requireCondition(value.length<=500,'XLSX_FIELD_LIMIT',`${reference}: field exceeds 500 characters`,400);values.set(column,value);
   }
   if(rowNumber===1){
    requireCondition(headers.length===0,'XLSX_HEADERS','Duplicate header row',400);
    for(let i=0;i<values.size;i++)headers.push(values.get(i)?.trim()??'');
    if(inspection)checkSourceHeaders(headers);
    else requireCondition(new Set(headers).size===headers.length&&required.every(h=>headers.includes(h))&&headers.every(h=>fields.includes(h)),'XLSX_HEADERS','Use the catalogue template headers without gaps, unknown or duplicate columns',400);
   }else if([...values.values()].some(v=>v!=='')){
    requireCondition(headers.length>0&&rowNumber===result.length+2,'XLSX_ROW_GAP','Keep product rows consecutive immediately below the header',400);
    requireCondition([...values.keys()].every(c=>c<headers.length),'XLSX_HEADERS','A data cell has no header',400);
    result.push(Object.fromEntries(headers.map((h,i)=>[h,values.get(i)??''])));
   }
  }
  requireCondition(result.length>0,'XLSX_ROW_LIMIT','Workbook has no product rows. Complete the template before uploading.',400);
  return result;
 }catch(e){if(e instanceof DomainError)throw e;throw invalid('Cannot read this workbook. Save a data-only .xlsx copy using the template.');}
}
