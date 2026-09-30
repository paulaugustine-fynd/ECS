import {config} from 'dotenv';
import {checkFyndConnection,readFyndConnection} from '../packages/integrations/fynd-connection';
config({path:'.env.fynd.local',quiet:true});
try{console.log(JSON.stringify(await checkFyndConnection(readFyndConnection(process.env)),null,2));}
catch(error){console.error(error instanceof Error?error.message:'Fynd check failed; integration remains disabled.');process.exitCode=1;}
