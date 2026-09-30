import SwaggerParser from '@apidevtools/swagger-parser';
import type {OpenAPIV3_1} from 'openapi-types';
import {contractCoverage} from '../../apps/api/src/openapi';

export async function validateOpenApi(document:OpenAPIV3_1.Document,{complete=false}={}){
 if(document.openapi!=='3.1.0')throw new Error('ECS requires OpenAPI 3.1.0.');
 // Never fetch remote references while validating an internally generated contract.
 await SwaggerParser.validate(structuredClone(document),{resolve:{http:false,file:false}});
 const report=contractCoverage(document),ids=new Set<string>();
 if(report.operations===0)throw new Error('No implemented API operations found.');
 for(const [path,item] of Object.entries(document.paths??{})){
  if(path!='/health'&&!path.startsWith('/api/v1/'))continue;
  for(const method of ['get','post','put','patch','delete'] as const){
   const op=item?.[method];if(!op)continue;
   if(!op.operationId||ids.has(op.operationId))throw new Error(`Missing/duplicate operationId: ${method} ${path}`);
   ids.add(op.operationId);
   for(const [,name] of path.matchAll(/\{([^}]+)\}/g)){
    if(!op.parameters?.some(p=>!('$ref' in p)&&p.in==='path'&&p.name===name&&p.required))throw new Error(`Missing required path parameter: ${path} ${name}`);
   }
   const publicRoute=path==='/health'||['/api/v1/auth/login','/api/v1/invitations/accept','/api/v1/webhooks/{source}'].includes(path);
   if(!publicRoute&&!op.security?.some(s=>'session' in s&&(method==='get'||'csrf' in s)))throw new Error(`Missing session/CSRF contract: ${method} ${path}`);
   if(path==='/api/v1/webhooks/{source}'&&!op.security?.some(s=>'webhookSignature' in s))throw new Error('Missing signed webhook security contract.');
   if(method==='post'&&!['/api/v1/auth/logout','/api/v1/documents/{id}/download-link'].includes(path)){
    const body=op.requestBody;
    if(!body||'$ref' in body||!body.required||!body.content['application/json']?.schema)throw new Error(`Missing required JSON input contract: ${method} ${path}`);
   }
   if(path!='/health'&&!op.responses?.['400'])throw new Error(`Missing error contract: ${method} ${path}`);
   if((op as Record<string,unknown>)['x-ecs-response-contract']==='documented'){
    const successes=Object.entries(op.responses??{}).filter(([code])=>/^2\d\d$/.test(code));
    if(!successes.length||successes.some(([,response])=>'$ref' in response||!Object.values(response.content??{}).some(media=>media.schema)))throw new Error(`Documented success has no payload schema: ${method} ${path}`);
   }
  }
 }
 if(report.missingRequests.length)throw new Error(`Undocumented request routes:\n${report.missingRequests.join('\n')}`);
 if(complete&&report.missingResponses.length)throw new Error(`Full response contracts remain incomplete (${report.missingResponses.length}):\n${report.missingResponses.join('\n')}`);
 return report;
}
