// Postgres error codes the actions turn into user-facing messages instead of
// a 500. drizzle wraps the driver error, so look at `cause` too.
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === "23505";
}

export function isForeignKeyViolation(err: unknown): boolean {
  return pgCode(err) === "23503";
}
