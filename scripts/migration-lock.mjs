import { performance } from "node:perf_hooks";

export const MIGRATION_LOCK_KEY = 621_026_220_214_001;
export const MIGRATION_LOCK_TIMEOUT_MS = 30_000;
export const MIGRATION_UNLOCK_TIMEOUT_MS = 5_000;
const MIGRATION_LOCK_POLL_INTERVAL_MS = 100;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function lockDeadlineError() {
  return new Error(
    "De migratie-lock bleef bezet; probeer de deployment later opnieuw.",
  );
}

async function boundedLockQuery(client, text, timeoutMs, timeoutMessage) {
  const boundedTimeoutMs = Math.max(1, Math.ceil(timeoutMs));
  const query = Promise.resolve().then(() =>
    client.query({
      text,
      values: [MIGRATION_LOCK_KEY],
      query_timeout: boundedTimeoutMs,
    }),
  );
  // A JS timeout may win just before node-postgres rejects its query timeout.
  void query.catch(() => undefined);
  let timer;
  try {
    return await Promise.race([
      query,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(timeoutMessage)),
          boundedTimeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function releaseMigrationLock(client, timeoutMs) {
  const unlock = await boundedLockQuery(
    client,
    "select pg_advisory_unlock($1::bigint) as unlocked",
    timeoutMs,
    "De migratie-lock kon niet tijdig worden vrijgegeven.",
  );
  if (unlock.rows?.[0]?.unlocked !== true) {
    throw new Error(
      "De migratie-lock hoorde niet bij deze databaseverbinding; mogelijk wordt een pooled URL gebruikt.",
    );
  }
}

async function acquireMigrationLock(client, options) {
  const timeoutMs = options.timeoutMs ?? MIGRATION_LOCK_TIMEOUT_MS;
  const pollIntervalMs =
    options.pollIntervalMs ?? MIGRATION_LOCK_POLL_INTERVAL_MS;
  // A wall-clock correction must not extend the deployment lock deadline.
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? delay;
  const unlockTimeoutMs =
    options.unlockTimeoutMs ?? MIGRATION_UNLOCK_TIMEOUT_MS;
  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0 ||
    !Number.isFinite(pollIntervalMs) ||
    pollIntervalMs <= 0 ||
    !Number.isFinite(unlockTimeoutMs) ||
    unlockTimeoutMs <= 0
  ) {
    throw new TypeError("De migratie-locktimeout is ongeldig.");
  }

  const deadline = now() + timeoutMs;
  while (true) {
    const remainingBeforeQuery = deadline - now();
    if (remainingBeforeQuery <= 0) throw lockDeadlineError();
    const lock = await boundedLockQuery(
      client,
      "select pg_try_advisory_lock($1::bigint) as locked",
      remainingBeforeQuery,
      "De query voor de migratie-lock duurde te lang.",
    );
    const remainingAfterQuery = deadline - now();
    if (lock.rows?.[0]?.locked === true) {
      if (remainingAfterQuery > 0) return;
      await releaseMigrationLock(client, unlockTimeoutMs);
      throw lockDeadlineError();
    }
    if (remainingAfterQuery <= 0) throw lockDeadlineError();
    await sleep(Math.min(pollIntervalMs, remainingAfterQuery));
  }
}

export async function withMigrationLock(client, applyMigrations, options = {}) {
  await acquireMigrationLock(client, options);
  let primaryError;
  let unlockError;
  let result;
  try {
    result = await applyMigrations();
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await releaseMigrationLock(
        client,
        options.unlockTimeoutMs ?? MIGRATION_UNLOCK_TIMEOUT_MS,
      );
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
