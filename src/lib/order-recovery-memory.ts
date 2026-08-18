const stagedRecoveryCodes = new Map<
  string,
  { code: string; expiresAt: number }
>();

const DISPLAY_TTL_MS = 5 * 60 * 1_000;
const MAX_STAGED_CODES = 20;

export function stageOrderRecoveryCode(orderId: string, code: string): void {
  const now = Date.now();
  for (const [id, entry] of stagedRecoveryCodes) {
    if (entry.expiresAt <= now) stagedRecoveryCodes.delete(id);
  }
  while (stagedRecoveryCodes.size >= MAX_STAGED_CODES) {
    const oldest = stagedRecoveryCodes.keys().next().value;
    if (typeof oldest !== "string") break;
    stagedRecoveryCodes.delete(oldest);
  }
  stagedRecoveryCodes.set(orderId, {
    code,
    expiresAt: now + DISPLAY_TTL_MS,
  });
}

export function consumeOrderRecoveryCode(orderId: string): string | null {
  const entry = stagedRecoveryCodes.get(orderId);
  stagedRecoveryCodes.delete(orderId);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.code;
}
