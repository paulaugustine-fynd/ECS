import type { System } from '../config/env';

export type Destination = {destinationMode: string; destinationOrigin: string};

// Operational live adapters are not enabled by the standalone read-only Fynd probe.
// Every queued command records its destination; dispatch must not re-read mode/origin.
export function validateDestination(value: Destination): Destination {
  if (value.destinationMode !== 'mock') throw new Error('Operational live destination is not tenant-validated; no request was sent');
  let origin: URL;
  try { origin = new URL(value.destinationOrigin); }
  catch { throw new Error('Invalid mock destination; no request was sent'); }
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      value.destinationOrigin !== origin.origin) {
    throw new Error('Mock destination must be a canonical loopback HTTP origin with an explicit port; no request was sent');
  }
  return {destinationMode: 'mock', destinationOrigin: origin.origin};
}

export function captureDestination(system: System, env: Record<string, string | undefined> = process.env): Destination {
  return validateDestination({destinationMode: env[`${system}_MODE`] ?? 'mock', destinationOrigin: env.MOCK_ORIGIN ?? 'http://127.0.0.1:4100'});
}
