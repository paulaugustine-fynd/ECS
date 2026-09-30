import type {BrandRight} from '@prisma/client';
export type RightScope=Pick<BrandRight,'brand'|'market'|'categories'|'status'|'validFrom'|'validUntil'>;
// Segment-boundary matching: Women/Bags does not grant Women/BagsOther.
export function hasBrandRight(rights:RightScope[],product:{brand:string;category:string;market:string},now:Date){
 return rights.some(r=>r.status==='APPROVED'&&r.brand===product.brand&&r.market===product.market&&r.validFrom<=now&&r.validUntil>now&&r.categories.some(c=>product.category===c||product.category.startsWith(c+'/')));
}
export function rightState(r:RightScope,now:Date){return r.status!=='APPROVED'?r.status:r.validFrom>now?'SCHEDULED':r.validUntil<=now?'EXPIRED':'EFFECTIVE';}
