import {it,expect} from 'vitest';
import {mediaJobInput,mediaJobReplay,zipMediaJobInput} from '../../packages/domain/media-source-jobs';
import {mediaJobResponse} from '../../packages/contracts/media-responses';
it('accepts only bounded deterministic DAM job requests and reasoned versioned replay',()=>{
 const input={requestId:crypto.randomUUID(),expectedVersion:1,sourceRef:'studio-front'};
 expect(mediaJobInput.parse(input).demoFailures).toBe(0);
 for(const change of [{sourceRef:'https://external.invalid'},{demoFailures:4},{expectedVersion:0},{actorId:'someone-else'},{destinationOrigin:'https://external.invalid'}])expect(mediaJobInput.safeParse({...input,...change}).success).toBe(false);
 expect(mediaJobReplay.safeParse({expectedVersion:1,reason:'Recovered the local source'}).success).toBe(true);expect(mediaJobReplay.safeParse({expectedVersion:1,reason:''}).success).toBe(false);
});
it('publishes job progress without lease tokens, requester internals or destination credentials',()=>{
 const now=new Date().toISOString(),value={id:'job',productId:'product',sourceType:'DAM',sourceRef:'studio-front',expectedVersion:1,demoFailures:0,status:'RETRY',version:2,attempts:1,cycleAttempts:1,replayCount:0,availableAt:now,receiptId:null,receiptIds:[],lastError:'DAM_TRANSIENT',createdAt:now,updatedAt:now};
 expect(mediaJobResponse.safeParse(value).success).toBe(true);for(const key of ['leaseToken','actorId','destinationOrigin','requestHash','bytes','base64','archive'])expect(mediaJobResponse.safeParse({...value,[key]:'private'}).success).toBe(false);
 expect(mediaJobResponse.safeParse({...value,sourceType:'ZIP',sourceRef:'images.zip',receiptIds:['receipt-1','receipt-2']}).success).toBe(true);
 expect(mediaJobResponse.safeParse({...value,receiptIds:Array.from({length:11},(_,i)=>`receipt-${i}`)}).success).toBe(false);
});
it('bounds queued ZIP input and keeps source bytes out of progress DTOs',()=>{
 const value={requestId:crypto.randomUUID(),expectedVersion:1,fileName:'images.zip',base64:'UEs='};
 expect(zipMediaJobInput.parse(value).demoFailures).toBe(0);
 for(const change of [{fileName:'../images.zip'},{destinationOrigin:'https://example.com'},{demoFailures:4},{byteSize:100}])expect(zipMediaJobInput.safeParse({...value,...change}).success).toBe(false);
});
