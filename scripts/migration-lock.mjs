export const MIGRATION_LOCK_KEY = 621_026_220_214_001;

export async function withMigrationLock(client, applyMigrations) {
  await client.query("select pg_advisory_lock($1::bigint)", [
    MIGRATION_LOCK_KEY,
  ]);
  let primaryError;
  let unlockError;
  let result;
  try {
    result = await applyMigrations();
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await client.query("select pg_advisory_unlock($1::bigint)", [
        MIGRATION_LOCK_KEY,
      ]);
    } catch (error) {
      unlockError = error;
    }
  }
  // A broken connection releases session locks when Postgres closes it.
  // Preserve a migration failure over a secondary unlock failure.
  if (primaryError) throw primaryError;
  if (unlockError) throw unlockError;
  return result;
}
