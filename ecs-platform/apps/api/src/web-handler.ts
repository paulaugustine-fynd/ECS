import {randomUUID} from 'node:crypto';
import type {FastifyInstance} from 'fastify';

// The bridge changes the HTTP transport, not authentication or business logic.
// Keep Fastify's per-route limits; this outer cap bounds buffering before inject.
const maxBodyBytes = 15 * 1024 * 1024;
const methods = new Set(['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']);
const hopByHop = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);

function errorResponse(status:number, code:string, message:string) {
  return Response.json({error:{code,message,correlationId:randomUUID()}}, {
    status, headers:{'cache-control':'no-store','x-content-type-options':'nosniff'},
  });
}

async function requestBody(request:Request):Promise<Buffer|undefined> {
  if (!request.body || request.method === 'GET' || request.method === 'HEAD') return;
  const reader = request.body.getReader();
  const chunks:Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        await reader.cancel();
        throw new RangeError('Request exceeds bridge limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

/** One lazy Fastify instance per warm runtime; a failed startup can be retried. */
export function createWebHandler(createApp:()=>Promise<FastifyInstance>) {
  let pending:Promise<FastifyInstance>|undefined;
  function app() {
    return pending ??= Promise.resolve().then(createApp).then(async instance => {
      try { await instance.ready(); return instance; }
      catch (error) { await instance.close(); throw error; }
    }).catch(error => { pending = undefined; throw error; });
  }
  return async function handle(request:Request):Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v1/')) return errorResponse(404,'NOT_FOUND','API route not found');
    if (!methods.has(request.method)) return errorResponse(405,'METHOD_NOT_ALLOWED','Method not allowed');
    let payload:Buffer|undefined;
    try { payload = await requestBody(request); }
    catch (error) {
      return error instanceof RangeError
        ? errorResponse(413,'BODY_TOO_LARGE','Request exceeds the API transport limit')
        : errorResponse(400,'INVALID_BODY','Unable to read request body');
    }
    const headers:Record<string,string> = {};
    // Do not let an untrusted Connection header remove Origin, Cookie or CSRF.
    // Forward only end-to-end headers and regenerate framing for the raw bytes.
    request.headers.forEach((value,key) => {
      if (!hopByHop.has(key) && key !== 'host' && key !== 'content-length' &&
          key !== 'forwarded' && !key.startsWith('x-forwarded-')) headers[key] = value;
    });
    headers.host = url.host;
    if (payload) headers['content-length'] = String(payload.byteLength);
    try {
      const instance = await app();
      const result = await instance.inject({
        method:request.method as 'GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE'|'OPTIONS',url:url.pathname+url.search,headers,payload,
        // Shared conservative anonymous rate-limit bucket; never trust user IP headers.
        remoteAddress:'127.0.0.1',
      });
      const responseHeaders = new Headers();
      for (const [key,value] of Object.entries(result.headers)) {
        if (value === undefined || hopByHop.has(key) || key === 'content-length') continue;
        for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key,String(item));
      }
      responseHeaders.set('cache-control','no-store');
      const noBody = request.method === 'HEAD' || [204,205,304].includes(result.statusCode);
      return new Response(noBody ? null : new Uint8Array(result.rawPayload),{status:result.statusCode,headers:responseHeaders});
    } catch {
      // Configuration/boot errors may contain connection strings: never expose them.
      return errorResponse(503,'API_UNAVAILABLE','API is unavailable; check server configuration');
    }
  };
}
