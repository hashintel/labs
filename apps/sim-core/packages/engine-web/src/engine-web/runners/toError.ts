export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "string") return new Error(err);
  if (err && typeof err === "object" && "message" in err) {
    return new Error(String((err as { message: unknown }).message));
  }
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error(String(err));
  }
}
