import { pathToFileURL } from 'node:url';
import { db } from '../packages/db/client';
import {seedBrandRights} from './brand-right-fixtures';
import { hashPassword } from '../packages/auth/security';
import { json } from '../packages/db/transaction';
import partners from '../seed/partners.json';
import products from '../seed/products.json';
import locations from '../seed/locations.json';
import stock from '../seed/inventory.json';
import users from '../seed/users.json';
import { sampleDocument,sampleApplication } from './document-fixtures';

export async function seedDemo() {
  if (process.env.NODE_ENV === 'production' || process.env.DEMO_MODE === 'false') throw new Error('Demo seed is disabled outside local demo mode');
  const existing=await db.partner.count();
  if(existing) throw new Error('Database already contains partners. Seed will not overwrite business state. Use the explicitly guarded demo:reset for the local demo database.');
  await db.$transaction(async tx=>{
    await tx.demoClock.create({data:{id:'main',now:new Date('2026-09-23T08:00:00Z')}});
    for(const p of partners){
      await tx.partner.create({data:{id:p.id,code:p.code,companyId:'cmp_ati_uae',legalName:p.legalName,displayName:p.displayName,status:p.status,markets:p.countries,erpVendorId:p.erpVendorId,riskTier:p.riskTier,trusted:p.trustedCatalogVendor,brandApproved:p.status==='ACTIVE',fyndMapped:true,inventorySynced:true,testOrderPassed:true}});
      for(const d of p.documents) await tx.document.create({data:{id:`doc_${p.id}_${d.type}`,partnerId:p.id,type:d.type,status:d.status,expiresAt:'expiresOn' in d&&d.expiresOn?new Date(d.expiresOn):null,...await sampleDocument(p.id,d.type)}});
      const rates: Record<string,string>={vnd_maz:'0.28',vnd_lum:'0.32',vnd_nrh:'0.25',vnd_orb:'0.27'};
      await tx.agreement.create({data:{id:`agreement_${p.id}_1`,partnerId:p.id,version:1,rate:rates[p.id],currency:'AED',cadence:p.settlement.cadence,validFrom:new Date('2026-01-01Z'),validUntil:new Date('2027-12-31Z'),status:'APPROVED',rules:{returnDays:30,handlingCharge:'20.00',categoryRates:p.id==='vnd_maz'?{Handbags:'0.30'}:{}}}});
    }
    // New application has no trading history. Established Maison Azure remains active.
    await tx.partner.create({data:{id:'vnd_onboard',code:'VND-NEW',companyId:'cmp_ati_uae',displayName:'Atelier Noor',legalName:'Atelier Noor Design LLC',status:'SUBMITTED',markets:['AE'],application:json(sampleApplication)}});
    for(const type of ['TRADE_LICENSE','VAT_CERTIFICATE','BANK_LETTER']) await tx.document.create({data:{id:`doc_onboard_${type}`,partnerId:'vnd_onboard',type,...await sampleDocument('vnd_onboard',type),expiresAt:type==='TRADE_LICENSE'?new Date('2027-06-30Z'):null}});
    await tx.agreement.create({data:{id:'agreement_onboard_1',partnerId:'vnd_onboard',version:1,rate:'0.28',validFrom:new Date('2026-01-01Z'),validUntil:new Date('2027-12-31Z'),status:'APPROVED',rules:{returnDays:30}}});
    for(const p of products){
      // Source fixture GTIN check digits are invalid. Preserve original in provenance.
      const prefix=p.gtin.slice(0,-1);const check=(10-[...prefix].reverse().reduce((s,n,i)=>s+Number(n)*(i%2===0?3:1),0)%10)%10;
      await tx.product.create({data:{id:p.id,companyId:'cmp_ati_uae',partnerId:p.partnerId,sku:p.variantSku,gtin:prefix+check,titleEn:p.title.en,titleAr:p.title.ar,category:p.category,brand:p.brandId,price:p.pricing.sellingPrice,floor:p.pricing.mapFloor,status:p.status,data:json({...p,sourceGtin:p.gtin,demoOnly:true})}});
      if(p.status==='PUBLISHED') for(const target of ['FYND','ERP','SFCC']) await tx.publication.create({data:{productId:p.id,version:1,target,status:'SUCCEEDED',externalId:`seed-${target}-${p.id}`}});
    }
    await seedBrandRights(tx);
    const dress=products[0];
    // A distinct replacement variant starts as a draft, without borrowed size-M
    // identities or fabricated downstream publication. Normal moderation publishes it.
    const replacementId='prd_maz_dress_1001_l',replacementSku='MAZ-DRS-1001-BLK-L',replacementPrefix='629110000102';
    const replacementGtin=replacementPrefix+(10-[...replacementPrefix].reverse().reduce((s,n,i)=>s+Number(n)*(i%2===0?3:1),0)%10)%10;
    const replacementTitle={en:'Maison Azure Silk Midi Dress - Black / L',ar:'فستان حرير ميدي - أسود / كبير'};
    await tx.product.create({data:{id:replacementId,companyId:'cmp_ati_uae',partnerId:'vnd_maz',sku:replacementSku,gtin:replacementGtin,titleEn:replacementTitle.en,titleAr:replacementTitle.ar,category:dress.category,brand:dress.brandId,price:'1850.00',floor:'1750.00',status:'DRAFT',data:json({...dress,id:replacementId,variantSku:replacementSku,gtin:replacementGtin,title:replacementTitle,status:'DRAFT',externalIds:{},attributes:{...dress.attributes,size:'L'},demoOnly:true})}});
    for(const l of locations) await tx.location.create({data:{id:l.id,companyId:'cmp_ati_uae',partnerId:l.ownerType==='PARTNER'?l.ownerId:null,name:l.name,type:l.type,market:l.country,status:l.status,fyndId:l.fyndLocationId}});
    for(const s of stock){
      const product=products.find(p=>p.variantSku===s.sku)!;const location=locations.find(l=>l.code===s.locationCode)!;
      await tx.inventory.create({data:{productId:product.id,locationId:location.id,onHand:s.onHand,reserved:s.reserved,safetyStock:s.safetyStock,sequence:1,syncedAt:new Date(s.asOf)}});
    }
    await tx.inventory.create({data:{productId:'prd_maz_dress_1001_l',locationId:'loc_maz_store1',onHand:8,safetyStock:1,sequence:1}});
    const hash=hashPassword('Demo123!');
    for(const u of users) await tx.user.create({data:{email:u.email,name:u.name,role:u.role,locale:u.locale,passwordHash:hash,companyId:'cmp_ati_uae',partnerId:'partnerId' in u?u.partnerId:null,markets:['AE']}});
    for(const u of [
      {email:'auditor@ati.demo',name:'ATI Auditor',role:'ATI_AUDITOR',partnerId:null},
      {email:'finance@maisonazure.demo',name:'Maison Azure Finance',role:'VENDOR_FINANCE_VIEWER',partnerId:'vnd_maz'},
      {email:'admin@ateliernoor.demo',name:'Atelier Noor Partner',role:'VENDOR_ADMIN',partnerId:'vnd_onboard'},
    ]) await tx.user.create({data:{...u,companyId:'cmp_ati_uae',passwordHash:hash,markets:['AE']}});
    await tx.auditEvent.create({data:{id:'seed-audit',companyId:'cmp_ati_uae',actorId:'seed',action:'demo.seed',entityId:'main',after:{fixtureVersion:1,source:'ATI supplied build pack',corrections:['Separate onboarding fixture','GTIN check digits','Replacement dress size L']},correlationId:'seed-v1'}});
  },{timeout:30000});
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{await seedDemo();console.log('Seeded local ECS demo.');}finally{await db.$disconnect();}
}
