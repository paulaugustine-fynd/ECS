/** Fictional inputs for existing forms. No parallel workflow state lives here. */
export const coachExample={
 displayName:'Coach UAE',legalName:'Coach UAE Demo Trading LLC',email:'admin@coachuae.demo',
 application:{registrationNumber:'DEMO-COACH-AE-001',taxRegistrationNumber:'DEMO-TAX-COACH-001',contactName:'Sara — Coach Demo',contactEmail:'admin@coachuae.demo',phone:'+971 50 000 0000',address:'Fictional demo office, Dubai, UAE',brands:'Coach',website:'https://example.com',beneficiaryName:'Coach UAE Demo Trading LLC',bankLast4:'0000',estimatedSkus:3,fulfilmentModel:'VENDOR_WAREHOUSE',declaration:false},
};
export const coachCategory='Women/Handbags/Shoulder Bags';
const gtin=(body:string)=>body+String((10-[...body].reduce((sum,n,i)=>sum+Number(n)*(i%2?3:1),0)%10)%10);
export function coachCatalogue(partnerCode:string,locationCode:string){
 return [
  ['COACH-TABBY-BLK','Tabby shoulder bag — black','حقيبة تابي سوداء','Black','2250.00','coach-tabby'],
  ['COACH-BROOKLYN-TAN','Brooklyn everyday bag — tan','حقيبة بروكلين بنية','Tan','1750.00','coach-brooklyn'],
  ['COACH-SWINGER-CRM','Swinger mini bag — cream','حقيبة سوينغر كريمية','Cream','1250.00','coach-swinger'],
 ].map(([sku,title,arabic,colour,price,asset],i)=>({partner_code:partnerCode,brand:'br_coach',vendor_sku:sku,gtin:gtin(`29993000000${i+1}`),parent_sku:sku+'-PARENT',title_en:title,title_ar:arabic,category:coachCategory,colour,size:'OS',list_price:price,selling_price:price,currency:'AED',image_url:`/demo-assets/${asset}.svg`,location_code:locationCode,quantity:'20',material:'Leather (sample)',country_of_origin:'VN'}));
}
