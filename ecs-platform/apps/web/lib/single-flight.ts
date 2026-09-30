// Coalesce concurrent reads only. No response cache survives completion and each
// caller creates its own instance, so credentials/users never share a global cache.
export function singleFlight<T>(read:(key:string)=>Promise<T>){
 const pending=new Map<string,Promise<T>>();
 return (key:string)=>{
  const existing=pending.get(key);if(existing)return existing;
  const result=Promise.resolve().then(()=>read(key));pending.set(key,result);
  void result.then(()=>pending.delete(key),()=>pending.delete(key));return result;
 };
}
export type MediaJob={id:string;sourceType:string;sourceRef:string;status:string;attempts:number;replayCount:number;version:number;demoFailures:number;lastError:string|null;receiptId:string|null;receiptIds:string[]};
