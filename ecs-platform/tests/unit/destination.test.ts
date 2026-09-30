import {describe,it,expect,vi,afterEach} from 'vitest';
import {captureDestination,validateDestination} from '../../packages/integrations/destination';
import {adapter} from '../../packages/integrations/adapter';
afterEach(()=>vi.unstubAllGlobals());
describe('immutable local mock destination boundary',()=>{
 it('captures only explicit loopback mock origins and refuses operational live mode',()=>{
  expect(captureDestination('FYND',{MOCK_ORIGIN:'http://127.0.0.1:4101'})).toEqual({destinationMode:'mock',destinationOrigin:'http://127.0.0.1:4101'});
  expect(()=>captureDestination('FYND',{FYND_MODE:'live'})).toThrow('not tenant-validated');
  for(const origin of ['https://api.fynd.com','http://localhost:4100','http://127.0.0.1:4100/path','http://127.0.0.1:4100?secret=x','http://user:pass@127.0.0.1:4100','http://127.0.0.1:99999']){
   expect(()=>validateDestination({destinationMode:'mock',destinationOrigin:origin})).toThrow();
  }
 });
 it('uses the pinned origin and disables redirects for requests carrying mock data',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({externalId:'mock-test',mode:'mock',system:'FYND',operation:'contractProbe'}));vi.stubGlobal('fetch',transport);
  await adapter('FYND',{destinationMode:'mock',destinationOrigin:'http://127.0.0.1:4199'}).execute('contractProbe',{}, {idempotencyKey:'bound',correlationId:'bound'});
  expect(transport.mock.calls[0][0]).toBe('http://127.0.0.1:4199/systems/FYND/contractProbe');
  expect(transport.mock.calls[0][1]?.redirect).toBe('error');
 });
 it('refuses invalid persisted destinations before sending anything',()=>{
  const transport=vi.fn<typeof fetch>();vi.stubGlobal('fetch',transport);
  expect(()=>adapter('FYND',{destinationMode:'live',destinationOrigin:'https://api.fynd.com'})).toThrow('no request was sent');
  expect(transport).not.toHaveBeenCalled();
 });
});
