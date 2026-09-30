import { randomUUID } from 'node:crypto';
import { putDocument,checksum,scanDocument } from '../packages/storage/documents';
export const sampleApplication={registrationNumber:'DEMO-ATI-2026',taxRegistrationNumber:'DEMO-TAX-001',contactName:'Noor Haddad',contactEmail:'admin@ateliernoor.demo',phone:'+971 50 000 0000',address:'Fictional design studio, Dubai, UAE',brands:'Atelier Noor',website:'',beneficiaryName:'Atelier Noor Design LLC',bankLast4:'0000',estimatedSkus:120,fulfilmentModel:'VENDOR_WAREHOUSE' as const,declaration:true};
export async function sampleDocument(partnerId:string,type:string){
  const bytes=Buffer.from(`FICTIONAL DEMONSTRATION EVIDENCE\nPartner: ${partnerId}\nDocument type: ${type}\nNo legal, tax or banking validity.\nThis local sample contains no real account or identity information.\n`);
  const objectKey=randomUUID(),contentType='text/plain',scan=scanDocument(bytes,contentType),storageMode=await putDocument(objectKey,bytes,contentType);
  return {objectKey,contentType,fileName:`SAMPLE-${type}.txt`,checksum:checksum(bytes),byteSize:bytes.length,scanStatus:scan.status,scanDetail:scan.detail,storageMode};
}
