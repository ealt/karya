export class KaryaError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "AMBIGUOUS_ID"
      | "INVALID_ID"
      | "INVALID_STATE"
      | "CONFIG"
      | "SYNC"
      | "VALIDATION"
      | "USAGE",
  ) {
    super(message);
    this.name = "KaryaError";
  }
}
