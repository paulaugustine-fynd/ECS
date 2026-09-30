import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {eventEnvelopeJsonSchema} from '../packages/events/contracts';
const checked=JSON.parse(readFileSync(new URL('../schemas/event-envelope.schema.json',import.meta.url),'utf8'));
if(!isDeepStrictEqual(checked,eventEnvelopeJsonSchema())){
 console.error('Event schema differs from the executable v1 envelope. Update schema and compatibility tests together.');process.exitCode=1;
}else console.log('Committed event-envelope JSON Schema matches the executable local v1 profile. This does not certify external-system compatibility.');
