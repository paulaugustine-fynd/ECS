import {describe,it,expect} from 'vitest';
import {validateRequirementsRegister} from '../../packages/contracts/requirements-register';

const register=()=>Array.from({length:54},(_,i)=>{
 const id=`REQ-${String(i+1).padStart(2,'0')}`,priority=[17,54].includes(i+1)?'Should Have':'Must Have';
 return `| ${id} | ${priority} | PARTIAL | [Implementation](packages/example.ts) | Browser proof remains. |`;
}).join('\n');
const check=(text:string)=>validateRequirementsRegister(text,path=>path==='packages/example.ts');

describe('requirement evidence register structure (not functional acceptance)',()=>{
 it('requires all 54 distinct IDs and preserves source priorities without treating partial as accepted',()=>{
  expect(check(register())).toEqual({errors:[],total:54,partial:54,notImplemented:0,accepted:0});
 });
 it('rejects missing, duplicate and invented requirement IDs',()=>{
  const text=register().replace('REQ-02','REQ-01')+'\n| REQ-55 | Must Have | PARTIAL | [Code](packages/example.ts) | Pending. |';
  expect(check(text).errors).toEqual(expect.arrayContaining(['Duplicate requirement: REQ-01','Missing requirement: REQ-02','Unexpected requirement ID: REQ-55']));
 });
 it('rejects incorrect priorities and undocumented status labels',()=>{
  const text=register().replace('REQ-17 | Should Have','REQ-17 | Must Have').replace('REQ-01 | Must Have | PARTIAL','REQ-01 | Should Have | GREEN');
  expect(check(text).errors).toEqual(expect.arrayContaining(['REQ-17: priority must be Should Have','REQ-01: priority must be Must Have','REQ-01: invalid status GREEN']));
 });
 it('requires explicit evidence and gaps and refuses missing files or nonlocal evidence',()=>{
  expect(check(register().replace('[Implementation](packages/example.ts)','No implementation link')).errors).toContain('REQ-01: at least one local evidence link is required');
  expect(check(register().replace('Browser proof remains.','')).errors).toContain('REQ-01: evidence and remaining acceptance must be explicit');
  expect(check(register().replace('packages/example.ts','packages/missing.ts')).errors).toContain('REQ-01: missing evidence file packages/missing.ts');
  expect(check(register().replace('packages/example.ts','https://example.com')).errors).toContain('REQ-01: evidence must be a safe project-relative path: https://example.com');
 });
 it('rejects traversal/absolute paths before invoking the file callback and malformed rows',()=>{
  for(const path of ['../outside.ts','/outside.ts']){
   const visited:string[]=[];
   const result=validateRequirementsRegister(register().replace('packages/example.ts',path),p=>{visited.push(p);return true;});
   expect(result.errors).toContain(`REQ-01: evidence must be a safe project-relative path: ${path}`);
   expect(visited).not.toContain(path);
  }
  expect(check(register().replace('Browser proof remains.','Extra | cell')).errors).toContain('Requirement rows must contain exactly five cells.');
 });
});
