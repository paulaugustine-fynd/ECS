import { Console } from '../../../components/console';
import {redirect} from 'next/navigation';
export default async function Operator({params}:{params:Promise<{path?:string[]}>}){const {path}=await params;if(path?.[0]==='coach')redirect('/operator/partners');return <Console/>;}
