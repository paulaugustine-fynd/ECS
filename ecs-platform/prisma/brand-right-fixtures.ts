import type {Prisma} from '@prisma/client';
// Explicit fictional grants, not a conversion of the old brandApproved Boolean.
const fixtures=[['vnd_maz','br_maz',['Women/Dresses','Women/Handbags']],['vnd_lum','br_lum',['Beauty/Skincare','Beauty/Makeup']],['vnd_nrh','br_nrh',['Home/Home Fragrance','Home/Bedding']],['vnd_orb','br_orb',['Men/Shoes']]] as const;
export async function seedBrandRights(tx:Prisma.TransactionClient){
 let count=0;
 for(const [partnerId,brand,categories] of fixtures){
  if(!await tx.partner.findUnique({where:{id:partnerId}})||await tx.brandRight.count({where:{partnerId,brand}}))continue;
  await tx.brandRight.create({data:{id:`fixture-right-${brand}`,partnerId,brand,market:'AE',categories:[...categories],validFrom:new Date('2026-01-01T00:00:00Z'),validUntil:new Date('2027-12-31T00:00:00Z'),status:'APPROVED',evidence:'Fictional demo grant — not a real distribution licence',reason:'Explicit sample trading rights for the supplied fictional brand scenario'}});count++;
 }
 return count;
}
