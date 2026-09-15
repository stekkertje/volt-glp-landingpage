export const LABEL_CLAIM_TTL_MS = 2 * 60 * 1_000;

export function labelClaimIsActive(
  requestedAt: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (!requestedAt) return false;
  const timestamp = new Date(requestedAt).getTime();
  return (
    Number.isFinite(timestamp) && timestamp > now.getTime() - LABEL_CLAIM_TTL_MS
  );
}
