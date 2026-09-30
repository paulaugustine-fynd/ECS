import {z} from 'zod';
import {validateDestination} from '../integrations/destination';
import {requireCondition,DomainError} from '../domain/errors';
import {imageBytes,bytesHash} from './image';
export const damReference=z.enum(['studio-front','studio-back']);
export const damAsset=z.object({reference:damReference,revision:z.literal('demo-v1'),fileName:z.literal('asset.png'),checksum:z.string().regex(/^[a-f0-9]{64}$/),base64:z.string().max(50000)}).strict();
export async function fetchDamAsset(reference:string,origin:string){
 requireCondition(process.env.DEMO_MODE==='true'&&process.env.NODE_ENV!=='production','DAM_DISABLED','Only the explicit local DAM simulator is implemented',503);
 validateDestination({destinationMode:'mock',destinationOrigin:origin});damReference.parse(reference);
 try{
  const response=await fetch(`${origin}/dam/assets/${reference}`,{headers:{'x-mock-secret':process.env.MOCK_SECRET??''},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok){await response.body?.cancel();throw new DomainError(response.status>=500?'DAM_TRANSIENT':'DAM_REJECTED','DAM source could not supply the requested asset',response.status>=500?503:400);}
  requireCondition(response.body,'DAM_INVALID','DAM returned no asset',400);const chunks:Uint8Array[]=[];let size=0;const reader=response.body.getReader();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;requireCondition(size<=65536,'DAM_INVALID','DAM metadata response exceeds the local fixture contract',400);chunks.push(value);}}finally{await reader.cancel();}
  const parsed=damAsset.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));requireCondition(parsed.reference===reference,'DAM_INVALID','DAM reference did not match the request',400);
  const bytes=imageBytes(parsed.base64);requireCondition(bytesHash(bytes)===parsed.checksum,'DAM_INVALID','DAM asset checksum mismatch',400);
  return {...parsed,bytes};
 }catch(e){if(e instanceof DomainError)throw e;if(e instanceof z.ZodError||e instanceof SyntaxError)throw new DomainError('DAM_INVALID','DAM response does not match the approved local contract',400);throw new DomainError('DAM_TRANSIENT','DAM fetch failed',503);}
}
