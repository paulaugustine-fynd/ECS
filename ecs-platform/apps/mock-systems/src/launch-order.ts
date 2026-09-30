import type {Prisma} from '@prisma/client';
import {launchPayload,launchFingerprint,launchStates} from '../../../packages/domain/launch-contract';
import {requireCondition} from '../../../packages/domain/errors';
import {transitionLeg} from '../../../packages/domain/calculations';
export async function mockLaunchStep(tx:Prisma.TransactionClient,system:string,input:unknown){
 const p=launchPayload.parse(input),state=launchStates[p.step];
 requireCondition(system===(p.step===7?'SFCC':'FYND'),'INVALID_TEST_TARGET','Incorrect launch-test target',409);
 requireCondition(launchFingerprint(p.scenario)===p.fingerprint&&Number(p.scenario.unitGross)>0,'INVALID_TEST_SNAPSHOT','Launch snapshot does not match its fingerprint',409);
 let order=await tx.mockLaunchOrder.findUnique({where:{runId:p.runId}});
 if(p.step===0){
  requireCondition(!order,'DUPLICATE_TEST_ORDER','Use the original idempotency key for the test order',409);
  order=await tx.mockLaunchOrder.create({data:{runId:p.runId,fingerprint:p.fingerprint,state,virtualOnHand:1,virtualReserved:1}});
 }else{
  requireCondition(order&&order.fingerprint===p.fingerprint,'TEST_ORDER_MISSING','Isolated order or fingerprint does not match',409);
  requireCondition(order.state===launchStates[p.step-1],'TEST_STEP_OUT_OF_ORDER','Previous isolated order step is not complete',409);
  if(p.step<7)transitionLeg(order.state,state,p.tracking);
  requireCondition(order.virtualReserved===(p.step<=5?1:0)&&order.virtualOnHand===(p.step<=5?1:0),'TEST_STOCK_INVARIANT','Virtual reservation is inconsistent',409);
  order=await tx.mockLaunchOrder.update({where:{runId:p.runId},data:{state,...(p.step===5?{virtualOnHand:0,virtualReserved:0}:{})}});
 }
 return {runId:p.runId,fingerprint:p.fingerprint,step:p.step,state:order.state,virtualOnHand:order.virtualOnHand,virtualReserved:order.virtualReserved};
}
