import {it,expect,vi} from 'vitest';
import {planImageRequest,publicMediaIPv4,validateImageResponse,validateImageSource,fetchImageSource} from '../../packages/media/url';
const env={MEDIA_URL_ALLOWED_HOSTS:'media.supplier.example'};
it('validates a queued source without DNS and rejects changed bindings before download',async()=>{
 expect(validateImageSource('https://media.supplier.example/front.png',env).url.origin).toBe('https://media.supplier.example');
 vi.stubEnv('MEDIA_URL_ALLOWED_HOSTS','media.supplier.example');
 try{await expect(fetchImageSource('https://media.supplier.example/front.png','https://different.example')).rejects.toMatchObject({code:'MEDIA_URL_BINDING'});}finally{vi.unstubAllEnvs();}
 for(const status of [429,500,502,503])expect(()=>validateImageResponse(status,{},'front.png')).toThrowError(expect.objectContaining({code:'MEDIA_URL_TRANSIENT'}));
 expect(()=>validateImageResponse(302,{},'front.png')).toThrowError(expect.objectContaining({code:'MEDIA_URL_HTTP'}));
});
it('accepts only approved canonical HTTPS image paths and pins a validated IPv4 answer',async()=>{
 const resolve=vi.fn(async()=>['8.8.8.8']);const plan=await planImageRequest('https://media.supplier.example/front.png',env,resolve);
 expect(plan).toMatchObject({address:'8.8.8.8',mock:false,fileName:'front.png'});expect(resolve).toHaveBeenCalledTimes(1);
 for(const url of ['http://media.supplier.example/front.png','https://unapproved.example/front.png','https://media.supplier.example:8443/front.png','https://x:secret@media.supplier.example/front.png','https://media.supplier.example/front.png?token=secret','https://media.supplier.example/front.png#x','https://media.supplier.example./front.png','https://127.0.0.1/front.png','https://[::1]/front.png','https://media.supplier.example/%2e%2e/front.png','https://media.supplier.example/file.svg'])await expect(planImageRequest(url,env,resolve)).rejects.toThrow();
 expect(resolve).toHaveBeenCalledTimes(1);
});
it('rejects every special/private answer and mixed DNS sets, including non-IPv4 results',async()=>{
 for(const address of ['127.0.0.1','10.2.3.4','100.64.0.1','169.254.169.254','172.16.0.1','192.168.1.1','0.0.0.0','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','::1','::ffff:8.8.8.8']){expect(publicMediaIPv4(address)).toBe(false);await expect(planImageRequest('https://media.supplier.example/front.png',env,async()=>['8.8.8.8',address])).rejects.toMatchObject({code:'MEDIA_URL_ADDRESS'});}
 await expect(planImageRequest('https://media.supplier.example/front.png',env,async()=>[])).rejects.toThrow();
});
it('allows only the exact demo alias bound to loopback in explicit non-production demo mode',async()=>{
 const demo={DEMO_MODE:'true',NODE_ENV:'test',MOCK_ORIGIN:'http://127.0.0.1:4101'};
 expect((await planImageRequest('demo://supplier/front.png',demo)).url.href).toBe('http://127.0.0.1:4101/media-demo/front.png');
 for(const change of [{DEMO_MODE:'false'},{NODE_ENV:'production'},{MOCK_ORIGIN:'http://public.example:4101'},{MOCK_ORIGIN:'http://127.0.0.1:4101/private'}])await expect(planImageRequest('demo://supplier/front.png',{...demo,...change})).rejects.toThrow();
 await expect(planImageRequest('demo://supplier/other.png',demo)).rejects.toThrow();
});
it('rejects redirects, unsupported encoding, wrong MIME and oversized declared bodies',()=>{
 expect(()=>validateImageResponse(200,{'content-type':'image/png','content-length':'100'},'front.png')).not.toThrow();
 for(const status of [201,301,302,307,404,500])expect(()=>validateImageResponse(status,{'content-type':'image/png'},'front.png')).toThrow();
 for(const headers of [{'content-type':'text/html'},{'content-type':'image/png','content-encoding':'gzip'},{'content-type':'image/png','content-length':'99999999'},{'content-type':'image/png','content-length':'0'}])expect(()=>validateImageResponse(200,headers,'front.png')).toThrow();
});
