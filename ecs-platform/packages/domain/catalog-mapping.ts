import {z} from 'zod';
import {importFields,requiredHeaders} from './catalog-fields';
import {requireCondition} from './errors';
export const sourceHeader=z.string().trim().min(1).max(80).refine(s=>[...s].every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127)&&!['__proto__','constructor','prototype'].includes(s),'Unsafe column name');
const canonical=z.enum(importFields);
export const fieldMapping=z.object({
 fields:z.record(canonical,sourceHeader),ignoredHeaders:z.array(sourceHeader).max(50),
 values:z.array(z.object({field:z.enum(['category','colour','size','currency','country_of_origin']),from:z.string().trim().min(1).max(500),to:z.string().trim().min(1).max(500)}).strict()).max(100).default([]),
}).strict();
export type FieldMapping=z.infer<typeof fieldMapping>;
export function checkSourceHeaders(headers:string[]){requireCondition(headers.length>0&&headers.length<=50&&new Set(headers).size===headers.length&&headers.every(h=>sourceHeader.safeParse(h).success),'IMPORT_SOURCE_HEADERS','Use 1–50 unique, non-empty source headers of at most 80 characters; reserved names are not allowed',400);}
export function mapCatalogSource(rows:Record<string,string>[],supplied?:FieldMapping,numericHeaders:string[]=[]){
 const headers=Object.keys(rows[0]??{});checkSourceHeaders(headers);
 const mapping=fieldMapping.parse(supplied??{fields:Object.fromEntries(importFields.filter(f=>headers.includes(f)).map(f=>[f,f])),ignoredHeaders:[],values:[]});
 const selected=Object.values(mapping.fields) as string[],ignored=mapping.ignoredHeaders;
 requireCondition(selected.every(h=>headers.includes(h))&&ignored.every(h=>headers.includes(h)),'IMPORT_MAPPING_SOURCE','Mapping references a column absent from this file',400);
 requireCondition(new Set([...selected,...ignored]).size===selected.length+ignored.length,'IMPORT_MAPPING_DUPLICATE','Use each source column once, either mapped or explicitly ignored',400);
 const keys=mapping.values.map(v=>JSON.stringify([v.field,v.from]));requireCondition(new Set(keys).size===keys.length,'IMPORT_MAPPING_VALUES','Each field/source value can have only one conversion',400);
 requireCondition(mapping.values.every(v=>Object.hasOwn(mapping.fields,v.field)),'IMPORT_MAPPING_VALUES','Value conversions require a mapped field',400);
 requireCondition(mapping.values.every(v=>v.field!=='currency'||v.from.toUpperCase()===v.to),'IMPORT_MAPPING_CURRENCY','Currency mapping may normalize letter case only; it cannot convert prices between currencies',400);
 const missingFields=requiredHeaders.filter(f=>!mapping.fields[f]),unmappedHeaders=headers.filter(h=>!selected.includes(h)&&!ignored.includes(h));
 const numericIssues=numericHeaders.filter(h=>selected.includes(h)&&!['quantity','selling_price','list_price'].some(f=>mapping.fields[f as keyof typeof mapping.fields]===h));
 const canonicalRows=rows.map(row=>Object.fromEntries(importFields.map(field=>{
  const header=mapping.fields[field];const raw=header?(row[header]??'').trim():'';
  return [field,mapping.values.find(v=>v.field===field&&v.from===raw)?.to??raw];
 })));
 return {sourceHeaders:headers,mapping,missingFields,unmappedHeaders,numericIssues,rowCount:rows.length,ready:!missingFields.length&&!unmappedHeaders.length&&!numericIssues.length,sampleRows:rows.slice(0,5).map((raw,index)=>({number:index+2,raw,canonical:canonicalRows[index]})),canonicalRows};
}
