/** An error whose message is safe to show to a student. Every other error stays private. */
export class PublicError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
