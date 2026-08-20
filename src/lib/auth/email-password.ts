/**
 * Local email/password sign-in (this app's Better Auth DB — not the broker).
 *
 * Enabled for the customer-account flow. Keep this as the single switch used
 * by the Better Auth server configuration.
 *
 * Do not duplicate this switch in client routes or deployment configuration.
 */
export const emailAndPasswordEnabled = true;
