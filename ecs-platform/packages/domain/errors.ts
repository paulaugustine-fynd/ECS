export class DomainError extends Error {
  constructor(public code: string, message: string, public statusCode = 422) { super(message); }
}
export function requireCondition(value: unknown, code: string, message: string, status = 422): asserts value {
  if (!value) throw new DomainError(code, message, status);
}
