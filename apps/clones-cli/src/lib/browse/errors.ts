/**
 * Custom error for clean exit propagation through nested async calls
 */
export class ExitRequestedError extends Error {
  constructor() {
    super('Exit requested');
    this.name = 'ExitRequestedError';
  }
}
