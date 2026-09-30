// Structural checks only: these do not execute or certify business acceptance.
export type RequirementStatus = 'PARTIAL' | 'NOT_IMPLEMENTED' | 'ACCEPTED';
export function validateRequirementsRegister(markdown:string,evidenceExists:(path:string)=>boolean){
 const errors:string[]=[];
 const rows=new Map<string,RequirementStatus>();
 for(const line of markdown.split('\n').filter(line=>/^\| REQ-/.test(line))){
  const cells=line.split('|').slice(1,-1).map(cell=>cell.trim());
  if(cells.length!==5){errors.push('Requirement rows must contain exactly five cells.');continue;}
  const [id,priority,status,evidence,gap]=cells;
  if(!/^REQ-(0[1-9]|[1-4][0-9]|5[0-4])$/.test(id)){errors.push(`Unexpected requirement ID: ${id}`);continue;}
  if(rows.has(id))errors.push(`Duplicate requirement: ${id}`);
  if(!['PARTIAL','NOT_IMPLEMENTED','ACCEPTED'].includes(status))errors.push(`${id}: invalid status ${status}`);
  rows.set(id,status as RequirementStatus);
  const expectedPriority=['REQ-17','REQ-54'].includes(id)?'Should Have':'Must Have';
  if(priority!==expectedPriority)errors.push(`${id}: priority must be ${expectedPriority}`);
  if(!gap||!evidence)errors.push(`${id}: evidence and remaining acceptance must be explicit`);
  const links=[...evidence.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(match=>match[1]);
  if(!links.length)errors.push(`${id}: at least one local evidence link is required`);
  for(const link of links){
   if(!/^[a-zA-Z0-9_./-]+$/.test(link)||link.startsWith('/')||link.split('/').includes('..'))errors.push(`${id}: evidence must be a safe project-relative path: ${link}`);
   else if(!evidenceExists(link))errors.push(`${id}: missing evidence file ${link}`);
  }
 }
 for(let n=1;n<=54;n++){
  const id=`REQ-${String(n).padStart(2,'0')}`;
  if(!rows.has(id))errors.push(`Missing requirement: ${id}`);
 }
 return {errors,total:rows.size,partial:[...rows.values()].filter(s=>s==='PARTIAL').length,notImplemented:[...rows.values()].filter(s=>s==='NOT_IMPLEMENTED').length,accepted:[...rows.values()].filter(s=>s==='ACCEPTED').length};
}
