import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {fetchImageSource} from '../../packages/media/url';
let server:Server,mode='ok',hits=0;
beforeAll(async()=>{
 server=createServer((req,res)=>{hits++;expect(req.url).toBe('/media-demo/front.png');expect(req.headers.authorization).toBeUndefined();expect(req.headers.cookie).toBeUndefined();
  if(mode==='redirect'){res.writeHead(302,{location:'http://169.254.169.254/latest/meta-data'});res.end();return;}
  if(mode==='wrong'){res.writeHead(200,{'content-type':'text/html'});res.end('<html/>');return;}
  res.writeHead(200,{'content-type':'image/png',...(mode==='truncated'?{'content-length':'900'}:{})});
  if(mode==='oversize'){res.end(Buffer.alloc(5*1024*1024+1));return;}
  res.end(Buffer.from('bounded response bytes'));
 });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));vi.stubEnv('MOCK_ORIGIN',`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
});
afterAll(async()=>{vi.unstubAllEnvs();server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));});
it('downloads bounded identity bytes through the exact mock target without forwarding credentials',async()=>{mode='ok';expect((await fetchImageSource('demo://supplier/front.png')).bytes.toString()).toBe('bounded response bytes');});
it('does not follow redirects or accept non-image responses',async()=>{for(const next of ['redirect','wrong']){mode=next;const before=hits;await expect(fetchImageSource('demo://supplier/front.png')).rejects.toThrow();expect(hits).toBe(before+1);}});
it('enforces the streamed byte cap and rejects truncated responses',async()=>{for(const next of ['oversize','truncated']){mode=next;await expect(fetchImageSource('demo://supplier/front.png')).rejects.toThrow();}});
