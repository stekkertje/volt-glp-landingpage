import { resolveDatabasePolicy } from "../../src/lib/db-policy";

// Nitro imports global middleware before routing. Keep the persistence guard
// outside React/Start loaders so a missing production database fails closed
// before any HTML or lazy PGLite asset can be served.
resolveDatabasePolicy(process.env);

export default function databaseGuard(
  _event: unknown,
  next: () => unknown | Promise<unknown>,
): unknown | Promise<unknown> {
  return next();
}
