import {it,expect,vi} from 'vitest';
import {singleFlight} from '../../apps/web/lib/single-flight';
it('coalesces concurrent same-key reads but never caches completed data',async()=>{
 let resolve!:(value:number)=>void;const read=vi.fn(()=>new Promise<number>(r=>{resolve=r;})),get=singleFlight(read);
 const a=get('product'),b=get('product');expect(a).toBe(b);await Promise.resolve();expect(read).toHaveBeenCalledTimes(1);resolve(1);expect(await a).toBe(1);await b;
 const c=get('product');expect(c).not.toBe(a);await Promise.resolve();expect(read).toHaveBeenCalledTimes(2);resolve(2);expect(await c).toBe(2);
});
it('keeps different products and separate user-owned instances independent',async()=>{
 const read=vi.fn(async(key:string)=>key),a=singleFlight(read),b=singleFlight(read);
 const first=a('one'),other=a('two'),user=b('one');expect(first).not.toBe(user);await Promise.all([first,other,user]);expect(read).toHaveBeenCalledTimes(3);
});
it('releases rejected reads so a retry performs a new authenticated request',async()=>{
 const read=vi.fn().mockRejectedValueOnce(Error('Denied')).mockResolvedValueOnce('fresh'),get=singleFlight(read);
 await expect(get('one')).rejects.toThrow('Denied');await expect(get('one')).resolves.toBe('fresh');expect(read).toHaveBeenCalledTimes(2);
});
