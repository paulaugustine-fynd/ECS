import {z} from 'zod';
import Decimal from 'decimal.js';
import {launchFingerprint} from './launch-contract';
const source=z.object({id:z.string(),companyId:z.string(),partnerId:z.string(),market:z.string(),version:z.number().int().positive(),sku:z.string(),titleEn:z.string(),titleAr:z.string(),brand:z.string(),category:z.string(),currency:z.string(),price:z.unknown(),data:z.unknown()});
export const storefrontContent=z.object({sku:z.string(),titleEn:z.string(),titleAr:z.string(),brand:z.string(),category:z.string(),currency:z.string(),price:z.string().regex(/^\d+\.\d{2}$/),attributes:z.record(z.string()),media:z.array(z.string()),merchant:z.literal('Bloomingdale’s'),merchantOfRecord:z.literal('Al Tayer Insignia')}).strict();
export const storefrontEnvelope=z.object({productId:z.string(),companyId:z.string(),partnerId:z.string(),market:z.string(),version:z.number().int().positive(),externalId:z.string().min(1),fingerprint:z.string().length(64),content:storefrontContent}).strict();
export function customerContent(raw:unknown){
 const p=source.parse(raw),data=p.data as {attributes?:Record<string,string>;media?:{url:string;status:string}[]};
 const attributes=Object.fromEntries(Object.entries(data?.attributes??{}).filter(([key])=>['colour','size','material','countryOfOrigin','skinType','finish','scent'].includes(key)));
 return storefrontContent.parse({sku:p.sku,titleEn:p.titleEn,titleAr:p.titleAr,brand:p.brand,category:p.category,currency:p.currency,price:new Decimal(String(p.price)).toFixed(2),attributes,media:(data?.media??[]).filter(m=>m.status==='APPROVED').map(m=>m.url),merchant:'Bloomingdale’s',merchantOfRecord:'Al Tayer Insignia'});
}
export function projectStorefront(raw:unknown,externalId:string){
 const p=source.parse(raw),content=customerContent(raw);
 return storefrontEnvelope.parse({productId:p.id,companyId:p.companyId,partnerId:p.partnerId,market:p.market,version:p.version,externalId,fingerprint:launchFingerprint(content),content});
}
