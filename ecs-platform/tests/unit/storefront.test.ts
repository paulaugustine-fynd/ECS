import {it,expect} from 'vitest';
import {customerContent,projectStorefront} from '../../packages/domain/storefront-contract';
it('projects exact price and approved bilingual customer fields without vendor/commercial metadata',()=>{
 const input={id:'p',companyId:'c',partnerId:'secret-vendor',market:'AE',version:1,sku:'S',titleEn:'Serum',titleAr:'مصل',brand:'Beauty',category:'Beauty/Skincare',currency:'AED',price:'320.00',floor:'250',commission:'0.30',data:{reviewReason:'private-review',attributes:{size:'30 ml',vendorId:'secret-vendor',commission:'0.30'},media:[{url:'/demo-assets/lum-serum.svg',status:'APPROVED'},{url:'/unreviewed',status:'PENDING'}]}};
 const content=customerContent(input);expect(content.price).toBe('320.00');expect(content.attributes).toEqual({size:'30 ml'});expect(content.media).toEqual(['/demo-assets/lum-serum.svg']);
 expect(JSON.stringify(content)).not.toMatch(/secret-vendor|commission|private-review|250|unreviewed/);
 expect(projectStorefront(input,'sfcc').fingerprint).toBe(projectStorefront({...input,floor:'200'},'sfcc').fingerprint);
 expect(projectStorefront(input,'sfcc').fingerprint).not.toBe(projectStorefront({...input,titleAr:'جديد'},'sfcc').fingerprint);
});
