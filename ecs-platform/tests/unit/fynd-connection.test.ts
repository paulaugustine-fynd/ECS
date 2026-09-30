import {describe,it,expect,vi} from 'vitest';
import {checkFyndConnection,readFyndConnection} from '../../packages/integrations/fynd-connection';
const input={FYND_CONNECTION_ENABLED:'true',FYND_TARGET_ENVIRONMENT:'test',FYND_API_ORIGIN:'https://api.fynd.com',FYND_COMPANY_ID:'1234',FYND_CLIENT_ID:'fictional-client',FYND_CLIENT_SECRET:'fictional-secret'};
const token={access_token:'fictional-access-token',token_type:'Bearer',expires_in:3599};
describe('Fynd read-only connection boundary (stub transport, no external calls)',()=>{
 it('fails closed before network for missing fields, disabled mode, production and unknown hosts',async()=>{
  for(const change of [{FYND_COMPANY_ID:''},{FYND_COMPANY_ID:'../other'},{FYND_CONNECTION_ENABLED:'false'},{FYND_TARGET_ENVIRONMENT:'production'},{FYND_API_ORIGIN:'https://untrusted.example'},{FYND_CLIENT_SECRET:''}]){
   const transport=vi.fn<typeof fetch>();await expect(checkFyndConnection({...input,...change} as ReturnType<typeof readFyndConnection>,transport)).rejects.toThrow('No request was sent');expect(transport).not.toHaveBeenCalled();
  }
 });
 it('authenticates then reads only the pinned company, returning no credentials or full profile',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json({uid:1234,name:'Fictional Fynd Test Company',addresses:[{private:'not returned'}]}));
  const result=await checkFyndConnection(readFyndConnection(input),transport);
  expect(transport.mock.calls.map(([url,options])=>[url,options?.method,options?.redirect])).toEqual([
   ['https://api.fynd.com/service/panel/authentication/v1.0/company/1234/oauth/token','POST','error'],
   ['https://api.fynd.com/service/platform/company-profile/v2.0/company/1234','GET','error'],
  ]);
  expect(result).toMatchObject({companyId:'1234',businessWritesEnabled:false,outboxConnected:false});
  expect(JSON.stringify(result)).not.toMatch(/fictional-secret|fictional-access-token|addresses|not returned/);
 });
 it('rejects a mismatched company and malformed token responses',async()=>{
  const wrong=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(token)).mockResolvedValueOnce(Response.json({uid:9999,name:'Wrong company'}));
  await expect(checkFyndConnection(readFyndConnection(input),wrong)).rejects.toThrow('identity');
  const malformed=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({access_token:'should-not-leak'}));
  await expect(checkFyndConnection(readFyndConnection(input),malformed)).rejects.toThrow('invalid token');expect(malformed).toHaveBeenCalledTimes(1);
 });
 it('does not echo upstream failure bodies, tokens or network errors',async()=>{
  const denied=vi.fn<typeof fetch>().mockResolvedValue(new Response('sensitive upstream error',{status:403}));
  await expect(checkFyndConnection(readFyndConnection(input),denied)).rejects.toThrow('HTTP 403');
  const failed=vi.fn<typeof fetch>().mockRejectedValue(new Error('fictional-secret inside transport error'));
  await expect(checkFyndConnection(readFyndConnection(input),failed)).rejects.toThrow('network, timeout or redirect');
 });
});
