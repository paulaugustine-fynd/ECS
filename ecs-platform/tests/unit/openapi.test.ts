import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import type {FastifyInstance} from 'fastify';
import type {OpenAPIV3_1} from 'openapi-types';
import {createServer} from '../../apps/api/src/server';
import {documentOpenApi,contractCoverage} from '../../apps/api/src/openapi';
import {validateOpenApi} from '../../packages/contracts/validate-openapi';

let app:FastifyInstance,document:OpenAPIV3_1.Document;
beforeAll(async()=>{app=await createServer();document=app.swagger() as OpenAPIV3_1.Document;});
afterAll(async()=>{await app?.close();});
const operation=(path:string,method:'get'|'post'='post')=>document.paths![`/api/v1${path}`]![method]!;
describe('implemented API contract, not the unimplemented handoff skeleton',()=>{
 it('validates OAS 3.1 and covers every registered request and success envelope',async()=>{
  const report=await validateOpenApi(document);
  expect(report.operations).toBeGreaterThan(60);expect(report.missingRequests).toEqual([]);
  expect(report.missingResponses).toEqual([]);
  await expect(validateOpenApi(document,{complete:true})).resolves.toEqual(report);
  const missing=structuredClone(document);
  (missing.paths!['/api/v1/catalog/items']!.get! as Record<string,unknown>)['x-ecs-response-contract']='pending';
  await expect(validateOpenApi(missing,{complete:true})).rejects.toThrow('Full response contracts remain incomplete');
  const placeholder=structuredClone(document);
  placeholder.paths!['/api/v1/catalog/items']!.get!.responses!['200']={description:'No actual schema'};
  await expect(validateOpenApi(placeholder,{complete:true})).rejects.toThrow('Documented success has no payload schema');
 });
 it('documents cookie+CSRF together and signed webhook auth separately from public login',()=>{
  expect(operation('/auth/login').security).toEqual([]);
  expect(operation('/auth/me','get').security).toEqual([{session:[]}]);
  expect(operation('/catalog/items/{id}/commands').security).toEqual([{session:[],csrf:[]}]);
  expect(operation('/webhooks/{source}').security).toEqual([{webhookSignature:[]}]);
  expect(operation('/webhooks/{source}').parameters).toContainEqual(expect.objectContaining({name:'x-webhook-timestamp',required:true}));
  expect(operation('/webhooks/{source}').responses).toHaveProperty('202');
  expect(operation('/webhooks/{source}').responses).not.toHaveProperty('200');
 });
 it('preserves raw input types, strictness, optimistic concurrency and distinct import sources',()=>{
  const input=(path:string)=>(operation(path).requestBody as OpenAPIV3_1.RequestBodyObject).content['application/json'].schema as OpenAPIV3_1.SchemaObject;
  const stock=input('/inventory/{id}/adjust');expect(stock.required).toContain('expectedSequence');expect(stock.additionalProperties).toBe(false);
  expect(input('/demo/faults').properties?.statusCode).toMatchObject({type:'string',enum:['422','503']});
  expect(input('/catalog/imports').anyOf).toHaveLength(3);
  expect(input('/catalog/items/{id}/draft').properties?.price).toMatchObject({type:'string'});
  expect(input('/catalog/items/{id}/commands').required).toContain('expectedVersion');
  expect(input('/partners/{id}/documents').properties?.base64).toMatchObject({type:'string',maxLength:7*1024*1024});
 });
 it('documents every required path parameter, query limit and scoped download media',()=>{
  const op=operation('/documents/{id}/download','get');
  expect(op.parameters).toContainEqual(expect.objectContaining({name:'id',in:'path',required:true}));
  expect(op.parameters).toContainEqual(expect.objectContaining({name:'signature',in:'query',required:true}));
  expect(operation('/inventory','get').parameters).toContainEqual(expect.objectContaining({name:'limit',schema:expect.objectContaining({maximum:100,default:25})}));
  expect(operation('/catalog/imports/template','get').responses?.['200']).toMatchObject({content:{'text/csv':{schema:{type:'string'}}}});
 });
 it('fails coverage on newly registered routes and duplicate operation identifiers',async()=>{
  const extra=structuredClone(document);extra.paths!['/api/v1/unknown']={post:{responses:{'200':{description:'Unknown'}}}};
  const transformed=documentOpenApi(extra);expect(contractCoverage(transformed).missingRequests).toContain('POST /api/v1/unknown');
  await expect(validateOpenApi(transformed)).rejects.toThrow();
  const missingBody=structuredClone(document);delete missingBody.paths!['/api/v1/inventory/{id}/adjust']!.post!.requestBody;
  await expect(validateOpenApi(missingBody)).rejects.toThrow('Missing required JSON input contract');
  const duplicate=structuredClone(document);duplicate.paths!['/api/v1/auth/login']!.post!.operationId=operation('/auth/logout').operationId;
  await expect(validateOpenApi(duplicate)).rejects.toThrow();
 });
 it('serves the same contract and real unauthenticated errors without needing a database',async()=>{
  const docs=await app.inject({method:'GET',url:'/docs/json'});expect(docs.statusCode).toBe(200);expect(docs.json()).toEqual(document);
  for(const url of ['/api/v1/auth/me','/api/v1/catalog/items','/api/v1/settlements']){
   const res=await app.inject({method:'GET',url});expect(res.statusCode).toBe(401);
   expect(res.json()).toEqual({error:{code:'UNAUTHENTICATED',message:'Sign in to continue',correlationId:res.headers['x-correlation-id']}});
  }
  const webhook=await app.inject({method:'POST',url:'/api/v1/webhooks/SFCC',payload:{}});
  expect(webhook.statusCode).toBe(401);expect(webhook.json().error.code).toBe('INVALID_SIGNATURE');
  const bad=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{email:'not-email',password:''}});
  expect(bad.statusCode).toBe(400);expect(bad.json().error.code).toBe('VALIDATION_ERROR');
 });
});
