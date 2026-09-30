import Fastify from 'fastify';
import { z } from 'zod';
import { db } from '../../../packages/db/client';
import { transaction, json } from '../../../packages/db/transaction';
import { digest } from '../../../packages/auth/security';
import { readEnv, systems } from '../../../packages/config/env';
import {mockLaunchStep} from './launch-order';
import {mappingPayload} from '../../../packages/domain/mappings';
import {launchFingerprint} from '../../../packages/domain/launch-contract';
import {requireCondition,DomainError} from '../../../packages/domain/errors';
import {projectStorefront,storefrontEnvelope} from '../../../packages/domain/storefront-contract';
import sharp from 'sharp';
import {damReference} from '../../../packages/media/dam';
import {bytesHash} from '../../../packages/media/image';
import {mockExchange} from './exchange';
export function createMockServer() {
  const env = readEnv();
  const app = Fastify({logger:false,bodyLimit:1024*1024});
  app.setErrorHandler((error,_req,reply)=>{
    if(error instanceof DomainError)return reply.code(error.statusCode).send({error:error.code});
    if(error instanceof z.ZodError)return reply.code(400).send({error:'INVALID_CONTRACT'});
    return reply.code(500).send({error:'MOCK_INTERNAL_ERROR'});
  });
  app.get('/health', async () => ({status:'ok', mode:'mock', systems}));
  app.get('/dam/assets/:reference',async(req,reply)=>{
    if(req.headers['x-mock-secret']!==env.MOCK_SECRET)return reply.code(401).send({error:'UNAUTHORIZED'});
    const reference=damReference.parse((req.params as {reference:string}).reference),bytes=await sharp({create:{width:256,height:256,channels:3,background:reference==='studio-front'?'#d8c4b0':'#9db6a8'}}).png().toBuffer();
    return {reference,revision:'demo-v1',fileName:'asset.png',checksum:bytesHash(bytes),base64:bytes.toString('base64')};
  });
  app.get('/media-demo/front.png',async(_req,reply)=>reply.type('image/png').send(await sharp({create:{width:256,height:256,channels:3,background:'#b8cad9'}}).png().toBuffer()));
  app.post('/systems/:system/:operation', async (req,reply) => {
    if (req.headers['x-mock-secret'] !== env.MOCK_SECRET) return reply.code(401).send({error:'UNAUTHORIZED'});
    const {system,operation} = z.object({system:z.enum(systems),operation:z.string().regex(/^[a-zA-Z]+$/)}).parse(req.params);
    const key = z.string().min(1).max(200).parse(req.headers['x-idempotency-key']);
    const hash = digest(JSON.stringify(req.body));
    const existing = await db.mockRecord.findUnique({where:{system_idempotencyKey:{system,idempotencyKey:key}}});
    if (existing) return existing.payloadHash === hash ? existing.response : reply.code(409).send({error:'IDEMPOTENCY_CONFLICT'});
    const failed = await db.adapterFault.updateMany({where:{system,remaining:{gt:0}},data:{remaining:{decrement:1}}});
    if (failed.count) return reply.code((await db.adapterFault.findUniqueOrThrow({where:{system}})).statusCode).send({error:'SEEDED_ADAPTER_FAILURE'});
    const response = {externalId:`mock-${system.toLowerCase()}-${digest(key).slice(0,12)}`,mode:'mock',system,operation};
    const saved = await transaction(async tx => {
      const repeated=await tx.mockRecord.findUnique({where:{system_idempotencyKey:{system,idempotencyKey:key}}});
      if(repeated)return repeated;
      if(system==='SFCC'&&['upsertProduct','publishStorefront'].includes(operation)){
        const value=operation==='publishStorefront'?storefrontEnvelope.parse(req.body):projectStorefront((req.body as {product:unknown}).product,response.externalId);
        requireCondition(launchFingerprint(value.content)===value.fingerprint,'INVALID_STOREFRONT','Customer-content fingerprint mismatch',409);
        const previous=await tx.mockStorefrontProduct.findUnique({where:{productId:value.productId}});
        requireCondition(!previous||previous.version<=value.version,'STALE_STOREFRONT','Older catalogue cannot replace newer storefront content',409);
        response.externalId=value.externalId;
        await tx.mockStorefrontProduct.upsert({where:{productId:value.productId},create:{...value,content:json(value.content)},update:{...value,visible:true,content:json(value.content)}});
      }
      if(operation==='provisionMapping'){
        const value=mappingPayload.parse(req.body);
        requireCondition(system==='FYND'&&launchFingerprint(value.snapshot)===value.fingerprint,'INVALID_MAPPING','Invalid mapping target or snapshot',409);
        response.externalId=`mock-fynd-${value.kind.toLowerCase()}-${value.key.slice(0,12)}`;
        await tx.mockMapping.upsert({where:{key:value.key},create:{key:value.key,fingerprint:value.fingerprint,externalId:response.externalId,kind:value.kind,snapshot:json(value.snapshot)},update:{fingerprint:value.fingerprint,snapshot:json(value.snapshot)}});
      }
      const launch=operation==='launchOrderStep'?await mockLaunchStep(tx,system,req.body):undefined;
      const exchange=await mockExchange(tx,system,operation,req.body,key,response.externalId);
      if(operation==='syncInventory'){
        const value=z.object({inventoryId:z.string(),revision:z.number().int().positive(),sellable:z.number().int().nonnegative()}).parse(req.body);
        const current=await tx.mockInventory.findUnique({where:{system_inventoryId:{system,inventoryId:value.inventoryId}}});
        if(!current)await tx.mockInventory.create({data:{system,...value}});
        else if(value.revision>current.revision)await tx.mockInventory.update({where:{system_inventoryId:{system,inventoryId:value.inventoryId}},data:value});
      }
      return tx.mockRecord.upsert({where:{system_idempotencyKey:{system,idempotencyKey:key}},update:{},create:{system,idempotencyKey:key,payloadHash:hash,response:json({...response,...(launch?{launch}:{}),...exchange})}});
    });
    if (saved.payloadHash !== hash) return reply.code(409).send({error:'IDEMPOTENCY_CONFLICT'});
    return saved.response;
  });
  return app;
}
