/**
 * Typed errors for the supervision domain, following the PluginPackageError
 * convention: the throw site declares the HTTP status and API error code so
 * the route layer never has to reverse-engineer them from the message.
 */
export class SupervisorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SupervisorError';
  }

  /** Referenced change/task does not exist. */
  static notFound(message: string): SupervisorError {
    return new SupervisorError(404, 'NOT_FOUND', message);
  }

  /** Entity exists but its current state does not allow the operation. */
  static invalidState(message: string): SupervisorError {
    return new SupervisorError(400, 'INVALID_STATE', message);
  }

  /** Request conflicts with existing state (e.g. active-change uniqueness). */
  static conflict(code: string, message: string): SupervisorError {
    return new SupervisorError(409, code, message);
  }

  /** Request payload fails domain validation. */
  static invalidInput(message: string): SupervisorError {
    return new SupervisorError(400, 'VALIDATION_ERROR', message);
  }
}
