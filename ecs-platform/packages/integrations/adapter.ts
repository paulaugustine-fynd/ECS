import { readEnv, type System } from '../config/env';
import {captureDestination, validateDestination, type Destination} from './destination';
import {inlineMockOrigin} from '../config/hosted-demo';
import {inlineMockRequest} from './inline-mock';
export class AdapterError extends Error {
  constructor(message: string, public retryable: boolean, public statusCode?: number) {super(message);}
}
export type IntegrationContext = {idempotencyKey: string; correlationId: string};
export type ExternalResult = {externalId: string; mode: 'mock'; system: System; operation: string; launch?:unknown};
export interface IntegrationPort {
  execute(operation: string, payload: unknown, context: IntegrationContext): Promise<ExternalResult>;
  health(): Promise<boolean>;
}
// Circuit state is process-local; durable attempts/DLQ live in PostgreSQL.
const circuits = new Map<string, {failures:number; until:number}>();
export function adapter(system: System, pinned?: Destination): IntegrationPort {
  const env = readEnv();
  let destination: Destination;
  try { destination = pinned ? validateDestination(pinned) : captureDestination(system); }
  catch { throw new AdapterError('Integration destination is not an approved local mock. Operational live adapters remain disabled; no request was sent.', false); }
  const origin = destination.destinationOrigin;
  const circuitKey = `${system}:${origin}`;
  return {
    async health() {
      try {return (origin===inlineMockOrigin?await inlineMockRequest('/health'):await fetch(`${origin}/health`, {redirect:'error',signal:AbortSignal.timeout(2000)})).ok;} catch {return false;}
    },
    async execute(operation, payload, ctx) {
      const circuit = circuits.get(circuitKey);
      if (circuit && circuit.until > Date.now()) throw new AdapterError(`${system} circuit is open`, true);
      try {
        const path=`/systems/${system}/${operation}`;
        const init={
          method:'POST' as const, redirect:'error' as const, signal:AbortSignal.timeout(8000),
          headers:{'content-type':'application/json','x-mock-secret':env.MOCK_SECRET,'x-idempotency-key':ctx.idempotencyKey,'x-correlation-id':ctx.correlationId},
          body:JSON.stringify(payload),
        };
        const response = origin===inlineMockOrigin?await inlineMockRequest(path,init):await fetch(`${origin}${path}`,init);
        if (!response.ok) throw new AdapterError(`${system} returned HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status);
        const result = await response.json() as ExternalResult;
        if (!result.externalId || result.mode !== 'mock' || result.system !== system) throw new AdapterError('Invalid adapter response', false);
        circuits.delete(circuitKey);
        return result;
      } catch(error) {
        const failure = error instanceof AdapterError ? error : new AdapterError(`${system} timeout or connection failure`,true);
        if (failure.retryable) {
          const failures = (circuit?.failures ?? 0)+1;
          circuits.set(circuitKey,{failures,until:failures >= 3 ? Date.now()+15000 : 0});
        }
        throw failure;
      }
    },
  };
}
