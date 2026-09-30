import { ZodError } from 'zod';
import { db } from '../../../packages/db/client';
import { transaction } from '../../../packages/db/transaction';
import { ingestOrder, orderInput } from '../../../packages/domain/orders';
import { DomainError, requireCondition } from '../../../packages/domain/errors';
import {ingestInvoice,invoiceInput} from '../../../packages/domain/invoices';
import {notifyOperations} from '../../../packages/domain/notifications';
import {openException,transitionException} from '../../../packages/domain/exception-lifecycle';
import {verifyStoredEnvelope} from '../../../packages/events/envelope';

export async function processInbox(id:string){
  try{
    return await transaction(async tx=>{
      const claimed=await tx.inbox.updateMany({where:{id,status:{in:['PENDING','RETRY']},availableAt:{lte:new Date()}},data:{status:'PROCESSING',attempts:{increment:1}}});
      if(!claimed.count)return false;
      const receipt=await tx.inbox.findUniqueOrThrow({where:{id}});
      verifyStoredEnvelope(receipt);
      requireCondition(receipt.source==='SFCC'&&['order.created','invoice.updated'].includes(receipt.type),'UNSUPPORTED_EVENT','This event type has no registered handler');
      const actor={id:'sfcc-webhook',companyId:receipt.companyId,markets:[receipt.market],partnerId:null,role:'ATI_SUPER_ADMIN'};
      if(receipt.type==='order.created')await ingestOrder(tx,actor,orderInput.parse(receipt.payload),receipt.correlationId);
      else await ingestInvoice(tx,actor,invoiceInput.parse(receipt.payload),receipt.id,receipt.correlationId);
      await tx.inbox.update({where:{id},data:{status:'PROCESSED',error:null}});
      await transitionException(tx,'INBOX_DLQ',id,'RESOLVED','Inbound event processed successfully.');return true;
    });
  }catch(error){
    const permanent=error instanceof DomainError||error instanceof ZodError;
    // Failed domain work rolls back completely, including the claim. Persist its failure separately.
    await transaction(async tx=>{
      const receipt=await tx.inbox.findUniqueOrThrow({where:{id}});
      if(!['PENDING','RETRY'].includes(receipt.status))return;
      const attempts=receipt.attempts+1,dead=permanent||attempts>=5;
      const message=error instanceof DomainError?`${error.code}: ${error.message}`:error instanceof ZodError?'INVALID_EVENT: Event payload failed schema validation':'Temporary database processing failure';
      await tx.inbox.update({where:{id},data:{attempts,status:dead?'DEAD_LETTER':'RETRY',error:message,availableAt:new Date(Date.now()+1000*2**attempts)}});
      if(dead){const exception=await openException(tx,{companyId:receipt.companyId,market:receipt.market,kind:'INBOX_DLQ',entityId:id,message});
       await notifyOperations(tx,{companyId:receipt.companyId,market:receipt.market,category:'INTEGRATION',severity:'CRITICAL',entityType:'INBOX_RECEIPT',entityId:id,eventKey:`inbox-dlq:${id}:exception-v${exception.version}`,title:'Inbound event needs operator review',message:`${receipt.source} ${receipt.type} could not be processed. Review the restricted receipt before replaying.`,eventAt:new Date()});}
    });return false;
  }
}
export async function pollInbox(){
  const receipts=await db.inbox.findMany({where:{status:{in:['PENDING','RETRY']},availableAt:{lte:new Date()}},select:{id:true},take:20,orderBy:{createdAt:'asc'}});
  for(const receipt of receipts)await processInbox(receipt.id);
}
