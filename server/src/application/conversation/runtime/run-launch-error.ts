/**
 * Error raised while preparing a provider run (pre-engine). `code` carries the
 * canonical runtime error code (see RUNTIME_ERROR_CODES) so the failure can be
 * attributed to the exact configuration problem instead of a generic crash.
 */
export class RunLaunchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RunLaunchError';
    this.code = code;
  }
}
