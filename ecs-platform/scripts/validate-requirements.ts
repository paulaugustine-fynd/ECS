import {readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateRequirementsRegister} from '../packages/contracts/requirements-register';

const root=fileURLToPath(new URL('../',import.meta.url));
const report=validateRequirementsRegister(readFileSync(resolve(root,'REQUIREMENTS_EVIDENCE.md'),'utf8'),path=>{
 try{return statSync(resolve(root,path)).isFile();}catch{return false;}
});
if(report.errors.length){console.error(report.errors.join('\n'));process.exitCode=1;}
else console.log(`Requirement register structure valid: ${report.total} IDs; ${report.partial} partial; ${report.notImplemented} not implemented; ${report.accepted} accepted. Evidence paths exist. This is NOT an acceptance test or live-integration certification.`);
