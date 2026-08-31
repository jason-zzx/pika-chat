export function apiErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "error" in error) {
    const wrapped = error.error;
    if (
      typeof wrapped === "object" &&
      wrapped !== null &&
      "message" in wrapped &&
      typeof wrapped.message === "string"
    ) {
      return wrapped.message;
    }
  }
  return fallback;
}
