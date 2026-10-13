export class BridgeError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function invariant(condition, code, message, status = 400) {
  if (!condition) throw new BridgeError(code, message, status);
}

export function publicError(error) {
  if (error instanceof BridgeError) return { code: error.code, message: error.message };
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return { code: 'request_timeout', message: 'Request cancelled or timed out.' };
  }
  return { code: 'internal_error', message: 'Operation failed. Inspect the local service log for the error code.' };
}
