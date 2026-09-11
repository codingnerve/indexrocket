/** Raised when a URL is malformed or uses an unsupported scheme. */
export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlValidationError';
  }
}

/** Raised when a URL resolves to an address the inspector must never contact. */
export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}
