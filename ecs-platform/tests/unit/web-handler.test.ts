import {afterEach,expect,it,vi} from 'vitest';
import Fastify,{type FastifyInstance} from 'fastify';
import {createWebHandler} from '../../apps/api/src/web-handler';

const instances:FastifyInstance[]=[];
function fixture(){const app=Fastify();instances.push(app);return app;}
afterEach(async()=>{await Promise.all(instances.splice(0).map(app=>app.close()));});

it('preserves query, raw JSON bytes, credentials and CSRF without trusting forwarded IPs',async()=>{
 const app=fixture();
 app.addContentTypeParser('application/x-test',{parseAs:'buffer'},(_req,body,done)=>done(null,body));
 app.post('/api/v1/echo',async req=>({raw:(req.body as Buffer).toString(),url:req.url,cookie:req.headers.cookie,csrf:req.headers['x-csrf-token'],origin:req.headers.origin,ip:req.ip,forwarded:req.headers['x-forwarded-for']??null}));
 const handler=createWebHandler(async()=>app);
 const response=await handler(new Request('https://ecs.example/api/v1/echo?a=one%20two&a=three',{method:'POST',headers:{'content-type':'application/x-test',cookie:'ecs_session=fictional','x-csrf-token':'csrf','origin':'https://ecs.example','x-forwarded-for':'1.2.3.4',connection:'origin, cookie'},body:' { "value" : 2 } '}));
 expect(await response.json()).toEqual({raw:' { "value" : 2 } ',url:'/api/v1/echo?a=one%20two&a=three',cookie:'ecs_session=fictional',csrf:'csrf',origin:'https://ecs.example',ip:'127.0.0.1',forwarded:null});
 expect(response.headers.get('cache-control')).toBe('no-store');
});

it('preserves independent Set-Cookie headers and binary downloads',async()=>{
 const app=fixture(),bytes=Buffer.from([0,255,128,1,2]);
 app.get('/api/v1/binary',async(_req,reply)=>reply.header('set-cookie',['first=one; HttpOnly; Path=/','second=two; SameSite=Strict; Path=/']).type('application/octet-stream').header('content-disposition','attachment; filename="test.bin"').send(bytes));
 const response=await createWebHandler(async()=>app)(new Request('https://ecs.example/api/v1/binary'));
 expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
 expect(response.headers.getSetCookie()).toHaveLength(2);
 expect(response.headers.get('content-disposition')).toContain('test.bin');
});

it('retains API errors and supports HEAD and empty 204 responses',async()=>{
 const app=fixture();
 app.get('/api/v1/private',async(_req,reply)=>reply.code(401).send({error:{code:'UNAUTHENTICATED'}}));
 app.delete('/api/v1/empty',async(_req,reply)=>reply.code(204).send());
 const handler=createWebHandler(async()=>app);
 const denied=await handler(new Request('https://ecs.example/api/v1/private'));
 expect(denied.status).toBe(401);expect(await denied.json()).toEqual({error:{code:'UNAUTHENTICATED'}});
 const head=await handler(new Request('https://ecs.example/api/v1/private',{method:'HEAD'}));expect(head.status).toBe(401);expect(await head.text()).toBe('');
 const empty=await handler(new Request('https://ecs.example/api/v1/empty',{method:'DELETE'}));expect(empty.status).toBe(204);expect(await empty.text()).toBe('');
});

it('shares initialization and retries boot failures without disclosing secrets',async()=>{
 const app=fixture();app.get('/api/v1/ok',async()=>({ok:true}));
 const boot=vi.fn().mockRejectedValueOnce(Error('postgresql://private:secret@database')).mockResolvedValue(app),handler=createWebHandler(boot);
 const first=await handler(new Request('https://ecs.example/api/v1/ok'));expect(first.status).toBe(503);expect(await first.text()).not.toContain('secret');
 const responses=await Promise.all([handler(new Request('https://ecs.example/api/v1/ok')),handler(new Request('https://ecs.example/api/v1/ok'))]);
 expect(responses.map(r=>r.status)).toEqual([200,200]);expect(boot).toHaveBeenCalledTimes(2);
});

it('bounds streamed requests and preserves stricter route-specific limits',async()=>{
 const app=fixture();app.post('/api/v1/small',{bodyLimit:10},async()=>({ok:true}));const boot=vi.fn(async()=>app),handler=createWebHandler(boot);
 const small=await handler(new Request('https://ecs.example/api/v1/small',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:'too much'})}));expect(small.status).toBe(413);
 const large=await handler(new Request('https://ecs.example/api/v1/small',{method:'POST',body:new Uint8Array(15*1024*1024+1)}));expect(large.status).toBe(413);expect((await large.json()).error.code).toBe('BODY_TOO_LARGE');expect(boot).toHaveBeenCalledTimes(1);
});

it('never exposes non-API paths or initializes a server for them',async()=>{
 const boot=vi.fn(),handler=createWebHandler(boot);
 for(const path of ['/health','/docs','/api/v10/private'])expect((await handler(new Request(`https://ecs.example${path}`))).status).toBe(404);
 expect(boot).not.toHaveBeenCalled();
});
