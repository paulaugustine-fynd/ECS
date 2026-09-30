export type User={id:string;name:string;email:string;role:string;companyId:string;partnerId:string|null;markets:string[];locale:string};
let csrf='';
export async function api<T>(path:string,body?:unknown):Promise<T>{
  if(process.env.NEXT_PUBLIC_ECS_HOSTED_DEMO==='true'&&body!==undefined&&new TextEncoder().encode(JSON.stringify(body)).length>3900000)throw new Error('Hosted demo upload is too large. Use a file below 2.8 MB; larger uploads require the direct-upload production integration.');
  const response=await fetch(`/api/v1${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'content-type':'application/json','x-csrf-token':csrf},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw new Error(`${result.error?.message??'Request failed'}${result.error?.correlationId?` · ${result.error.correlationId.slice(0,8)}`:''}`);
  if(result.csrfToken)csrf=result.csrfToken;
  return result as T;
}
export type Application={registrationNumber:string;taxRegistrationNumber:string;contactName:string;contactEmail:string;phone:string;address:string;brands:string;website:string;beneficiaryName:string;bankLast4:string;estimatedSkus:number;fulfilmentModel:string;declaration:boolean};
export type PartnerAccess={application:boolean;commercials:boolean;documentTypes:string[]};
export function partnerAccess(partner:Partner){return (partner as Partner&{access?:PartnerAccess}).access;}
export type Partner={id:string;displayName:string;legalName:string;status:string;version:number;code:string;markets:string[];erpVendorId:string|null;brandApproved:boolean;fyndMapped:boolean;application?:Partial<Application>;applicationIssues?:string[];reviewReason?:string|null;agreements?:{id:string;version:number;rate:string;currency:string;cadence:string;status:string;validFrom:string;validUntil:string}[];documents?:{id:string;type:string;status:string;fileName:string;expiresAt:string|null;version:number;byteSize:number;scanStatus:string;scanDetail:string|null;reason:string|null}[];readiness?:{key:string;label:string;passed:boolean;detail?:string;mappings?:{kind:string;canonicalId:string;market:string;passed:boolean;externalId:string|null;detail:string}[];positions?:{inventoryId:string;sku:string;locationName:string;revision:number;expectedSellable:number;passed:boolean;issues:string[]}[]}[]};
