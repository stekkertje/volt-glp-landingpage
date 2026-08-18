import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";

let vite;
let CHECKOUT_ATTEMPT_STORAGE_KEY;
let CHECKOUT_ATTEMPT_TTL_MS;
let COMPLETED_CART_EPOCH_STORAGE_KEY;
let CHECKOUT_REPLAY_EXPIRED_ERROR_MESSAGE;
let checkoutAttemptMarkerCookieDirective;
let checkoutAttemptMarkerCookieName;
let checkoutIdempotencyKeyFromSeed;
let clearCheckoutAttemptSeedIfMatches;
let finalizeCheckoutAttemptAfterSuccess;
let initializeCheckoutAttemptSeed;
let loadCheckoutAttemptSeed;
let isCheckoutReplayExpiredError;
let markCheckoutAttemptReplayExpired;
let markCheckoutAttemptWithCommittedCart;
let markCheckoutCartEpochCompleted;
let parseCheckoutAttemptMarkerCookies;
let persistCheckoutAttemptSeed;
let prepareCheckoutAttemptSeedForSubmit;
let refreshCheckoutAttemptSeed;

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    CHECKOUT_ATTEMPT_STORAGE_KEY,
    CHECKOUT_ATTEMPT_TTL_MS,
    CHECKOUT_REPLAY_EXPIRED_ERROR_MESSAGE,
    checkoutAttemptMarkerCookieDirective,
    checkoutAttemptMarkerCookieName,
    checkoutIdempotencyKeyFromSeed,
    clearCheckoutAttemptSeedIfMatches,
    finalizeCheckoutAttemptAfterSuccess,
    initializeCheckoutAttemptSeed,
    isCheckoutReplayExpiredError,
    loadCheckoutAttemptSeed,
    markCheckoutAttemptReplayExpired,
    markCheckoutAttemptWithCommittedCart,
    markCheckoutCartEpochCompleted,
    parseCheckoutAttemptMarkerCookies,
    persistCheckoutAttemptSeed,
    prepareCheckoutAttemptSeedForSubmit,
    refreshCheckoutAttemptSeed,
  } = await vite.ssrLoadModule("/src/lib/checkout-idempotency.ts"));
  ({ COMPLETED_CART_EPOCH_STORAGE_KEY } = await vite.ssrLoadModule(
    "/src/lib/cart-lifecycle.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("confirmed checkout proves a recovery URL before clearing the cart", async () => {
  const source = await readFile("src/routes/checkout.tsx", "utf8");
  const confirmedResult = source.indexOf("result = await createOrder");
  const stageRecovery = source.indexOf(
    "stageOrderRecoveryCode(result.order.id, result.guestAccessToken)",
    confirmedResult,
  );
  const commitSubmitGuard = source.indexOf(
    "confirmedOrderRef.current = committed",
    stageRecovery,
  );
  const suppressEmptyRedirect = source.indexOf(
    "emptyRedirected.current = true",
    commitSubmitGuard,
  );
  const startNavigation = source.indexOf(
    "const confirmationNavigation = new Promise",
    suppressEmptyRedirect,
  );
  const proveCommittedUrl = source.indexOf(
    "const committedUrlReady = await establishCommittedOrderUrl(",
    startNavigation,
  );
  const preserveReplayableState = source.indexOf(
    "if (!committedUrlReady)",
    proveCommittedUrl,
  );
  const markCompletedCartEpoch = source.indexOf(
    "await markCheckoutCartEpochCompleted(cartEpoch)",
    preserveReplayableState,
  );
  const clearPersistedCart = source.indexOf(
    "clearCart()",
    markCompletedCartEpoch,
  );
  const finalizeAttempt = source.indexOf(
    "await finalizeCheckoutAttemptAfterSuccess(confirmedAttempt)",
    clearPersistedCart,
  );

  assert.ok(confirmedResult >= 0);
  assert.ok(stageRecovery > confirmedResult);
  assert.ok(commitSubmitGuard > stageRecovery);
  assert.ok(suppressEmptyRedirect > commitSubmitGuard);
  assert.ok(startNavigation > suppressEmptyRedirect);
  assert.ok(proveCommittedUrl > startNavigation);
  assert.ok(preserveReplayableState > proveCommittedUrl);
  assert.ok(markCompletedCartEpoch > preserveReplayableState);
  assert.ok(clearPersistedCart > markCompletedCartEpoch);
  assert.ok(finalizeAttempt > clearPersistedCart);
});

test("a versioned checkout seed derives stable private idempotency keys", async () => {
  const seed = "a".repeat(64);
  const first = await checkoutIdempotencyKeyFromSeed(seed);
  const retry = await checkoutIdempotencyKeyFromSeed(seed);
  const nextAttempt = await checkoutIdempotencyKeyFromSeed("b".repeat(64));

  assert.match(first, /^checkout-v2-[a-f0-9]{64}$/);
  assert.equal(retry, first);
  assert.notEqual(nextAttempt, first);
});

test("checkout storage contains only a short-lived seed and survives reload", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const attempt = await initializeCheckoutAttemptSeed(storage, now, () =>
    "b".repeat(64),
  );
  assert.ok(attempt);
  const raw = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);

  assert.ok(raw);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
    "expiresAt",
    "seed",
    "version",
  ]);
  assert.doesNotMatch(raw, /Noor|noor@example|0612345678|Teststraat|1234 AB/);
  assert.equal(CHECKOUT_ATTEMPT_TTL_MS, 72 * 60 * 60 * 1_000);
  assert.equal(attempt.expiresAt, now + 72 * 60 * 60 * 1_000);
  assert.deepEqual(loadCheckoutAttemptSeed(storage, now + 1), attempt);
  assert.deepEqual(
    await initializeCheckoutAttemptSeed(storage, now + 1, () => "c".repeat(64)),
    attempt,
  );
});

test("submitting late extends the same seed through the complete replay window", async () => {
  const startedAt = Date.parse("2026-08-18T12:00:00.000Z");
  const submittedAt = startedAt + 71 * 60 * 60 * 1_000;
  const reloadedAt = startedAt + 73 * 60 * 60 * 1_000;
  const storage = new MemoryStorage();
  const initial = await initializeCheckoutAttemptSeed(storage, startedAt, () =>
    "4".repeat(64),
  );
  assert.ok(initial);
  const refreshed = refreshCheckoutAttemptSeed(initial, submittedAt);

  assert.equal(persistCheckoutAttemptSeed(refreshed, storage), true);
  assert.equal(refreshed.seed, initial.seed);
  assert.equal(refreshed.expiresAt, submittedAt + CHECKOUT_ATTEMPT_TTL_MS);
  assert.deepEqual(loadCheckoutAttemptSeed(storage, reloadedAt), refreshed);
  assert.equal(
    await checkoutIdempotencyKeyFromSeed(refreshed.seed),
    await checkoutIdempotencyKeyFromSeed(initial.seed),
  );
});

test("a completed cart epoch blocks stale tabs but permits the next generation", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const attempt = await initializeCheckoutAttemptSeed(storage, now, () =>
    "6".repeat(64),
  );
  assert.ok(attempt);

  assert.equal(await markCheckoutCartEpochCompleted(7, storage), true);
  assert.equal(storage.getItem(COMPLETED_CART_EPOCH_STORAGE_KEY), "7");
  assert.deepEqual(
    await prepareCheckoutAttemptSeedForSubmit(
      attempt,
      storage,
      now + 1,
      () => "7".repeat(64),
      7,
    ),
    { ok: false, reason: "completed-cart" },
  );

  const fresh = await prepareCheckoutAttemptSeedForSubmit(
    attempt,
    storage,
    now + 1,
    () => "7".repeat(64),
    8,
  );
  assert.equal(fresh.ok, true);
  assert.equal(fresh.ok ? fresh.attempt.seed : null, attempt.seed);
});

test("a backward clock correction never rotates an unresolved checkout seed", async () => {
  const startedAt = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const initial = await initializeCheckoutAttemptSeed(storage, startedAt, () =>
    "9".repeat(64),
  );
  assert.ok(initial);
  const initialKey = await checkoutIdempotencyKeyFromSeed(initial.seed);

  for (const correctedNow of [
    startedAt - 1,
    startedAt - 30 * 24 * 60 * 60 * 1_000,
  ]) {
    const restored = await initializeCheckoutAttemptSeed(
      storage,
      correctedNow,
      () => "8".repeat(64),
    );
    assert.equal(restored.seed, initial.seed);
    assert.equal(
      await checkoutIdempotencyKeyFromSeed(restored.seed),
      initialKey,
    );
    const prepared = await prepareCheckoutAttemptSeedForSubmit(
      restored,
      storage,
      correctedNow,
    );
    assert.equal(prepared.ok, true);
    assert.equal(prepared.attempt.seed, initial.seed);
    assert.equal(
      prepared.attempt.expiresAt,
      correctedNow + CHECKOUT_ATTEMPT_TTL_MS,
    );
    assert.equal(
      await checkoutIdempotencyKeyFromSeed(prepared.attempt.seed),
      initialKey,
    );
  }
});

test("corrupt storage is replaced but an expired unresolved seed is retained", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  storage.setItem(CHECKOUT_ATTEMPT_STORAGE_KEY, "not-json");

  const replacement = await initializeCheckoutAttemptSeed(storage, now, () =>
    "d".repeat(64),
  );
  assert.ok(replacement);
  assert.equal(replacement.seed, "d".repeat(64));

  storage.setItem(
    CHECKOUT_ATTEMPT_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      seed: "f".repeat(64),
      expiresAt: now + CHECKOUT_ATTEMPT_TTL_MS,
      name: "Noor de Vries",
    }),
  );
  const unexpectedFieldReplacement = await initializeCheckoutAttemptSeed(
    storage,
    now,
    () => "3".repeat(64),
  );
  assert.equal(unexpectedFieldReplacement.seed, "3".repeat(64));

  const afterExpiry = await initializeCheckoutAttemptSeed(
    storage,
    now + CHECKOUT_ATTEMPT_TTL_MS + 1,
    () => "e".repeat(64),
  );
  assert.equal(afterExpiry.seed, unexpectedFieldReplacement.seed);
  const preparedAfterExpiry = await prepareCheckoutAttemptSeedForSubmit(
    afterExpiry,
    storage,
    now + CHECKOUT_ATTEMPT_TTL_MS + 2,
  );
  assert.equal(preparedAfterExpiry.ok, true);
  assert.equal(preparedAfterExpiry.attempt.seed, afterExpiry.seed);
  assert.equal(preparedAfterExpiry.attempt.expiresAt, afterExpiry.expiresAt);
});

test("production marker cookies are host-only and duplicate parsing is defensive", () => {
  const proof = "a".repeat(64);
  const otherProof = "b".repeat(64);
  const productionName = checkoutAttemptMarkerCookieName("https:");
  const localName = checkoutAttemptMarkerCookieName("http:");
  const productionDirective = checkoutAttemptMarkerCookieDirective(
    "https:",
    "consumed",
    proof,
  );
  const localDirective = checkoutAttemptMarkerCookieDirective(
    "http:",
    "replay-expired",
    proof,
  );

  assert.match(productionName, /^__Host-/);
  assert.notEqual(localName, productionName);
  assert.match(productionDirective, /^__Host-/);
  assert.match(productionDirective, /; Secure/);
  assert.match(productionDirective, /; Path=\//);
  assert.match(productionDirective, /; SameSite=Strict/);
  assert.doesNotMatch(productionDirective, /Domain=/i);
  assert.doesNotMatch(localDirective, /; Secure/);
  assert.doesNotMatch(localDirective, /Domain=/i);

  const parsed = parseCheckoutAttemptMarkerCookies(
    [
      `${productionName}=%E0%A4%A`,
      `${productionName}=consumed.${otherProof}`,
      `${productionName}=attacker.${proof}`,
      `${productionName}=replay-expired.${proof}`,
      `Domain=.example.test`,
    ].join("; "),
    productionName,
  );
  assert.deepEqual(parsed, [
    { kind: "consumed", proof: otherProof },
    { kind: "replay-expired", proof },
  ]);
});

test("410 replay expiry is recognized and permanently blocks that attempt", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const attempt = await initializeCheckoutAttemptSeed(storage, now, () =>
    "0".repeat(64),
  );
  assert.ok(attempt);

  for (const error of [
    { status: 410 },
    { statusCode: 410 },
    { name: "IdempotencyReplayExpiredError" },
    { message: CHECKOUT_REPLAY_EXPIRED_ERROR_MESSAGE },
  ]) {
    assert.equal(isCheckoutReplayExpiredError(error), true);
  }
  assert.equal(isCheckoutReplayExpiredError({ status: 409 }), false);

  await markCheckoutAttemptReplayExpired(attempt);
  const storedBefore = storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY);
  assert.deepEqual(
    await prepareCheckoutAttemptSeedForSubmit(
      attempt,
      storage,
      now + CHECKOUT_ATTEMPT_TTL_MS + 1,
    ),
    { ok: false, reason: "replay-expired" },
  );
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), storedBefore);
});

test("a confirmed order with an uncleared cart keeps its attempt terminal", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const attempt = await initializeCheckoutAttemptSeed(storage, now, () =>
    "ab".repeat(32),
  );
  assert.ok(attempt);
  const originalKey = await checkoutIdempotencyKeyFromSeed(attempt.seed);

  await markCheckoutAttemptWithCommittedCart(attempt);
  assert.deepEqual(
    await prepareCheckoutAttemptSeedForSubmit(attempt, storage, now + 1),
    { ok: false, reason: "committed-cart" },
  );

  const restored = await initializeCheckoutAttemptSeed(storage, now + 2, () =>
    "cd".repeat(32),
  );
  assert.equal(restored.seed, attempt.seed);
  assert.equal(
    await checkoutIdempotencyKeyFromSeed(restored.seed),
    originalKey,
  );
});

test("confirmed success only clears the seed used by that checkout", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const first = await initializeCheckoutAttemptSeed(storage, now, () =>
    "f".repeat(64),
  );
  assert.ok(first);
  const newer = {
    ...first,
    seed: "1".repeat(64),
  };
  persistCheckoutAttemptSeed(newer, storage);

  assert.equal(clearCheckoutAttemptSeedIfMatches(first, storage), false);
  assert.deepEqual(loadCheckoutAttemptSeed(storage, now), newer);
  assert.equal(clearCheckoutAttemptSeedIfMatches(newer, storage), true);
  assert.equal(storage.getItem(CHECKOUT_ATTEMPT_STORAGE_KEY), null);
});

test("confirmed success replaces a seed when storage cleanup throws or is ignored", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");

  for (const cleanupFailure of ["throws", "no-op"]) {
    const storage = new MemoryStorage();
    const used = await initializeCheckoutAttemptSeed(storage, now, () =>
      "6".repeat(64),
    );
    assert.ok(used);
    storage.removeItem =
      cleanupFailure === "throws"
        ? () => {
            throw new Error("remove failed");
          }
        : () => undefined;

    const replacement = await finalizeCheckoutAttemptAfterSuccess(
      used,
      storage,
      now + 1,
      () => "7".repeat(64),
    );

    assert.equal(replacement?.seed, "7".repeat(64), cleanupFailure);
    assert.notEqual(replacement?.seed, used.seed, cleanupFailure);
    assert.deepEqual(
      loadCheckoutAttemptSeed(storage, now + 2),
      replacement,
      cleanupFailure,
    );
  }
});

test("failed cleanup and replacement never makes a consumed seed reusable", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const used = await initializeCheckoutAttemptSeed(storage, now, () =>
    "8".repeat(64),
  );
  assert.ok(used);
  storage.removeItem = () => undefined;
  storage.setItem = () => undefined;

  assert.equal(
    await finalizeCheckoutAttemptAfterSuccess(used, storage, now + 1, () =>
      "9".repeat(64),
    ),
    null,
  );
  assert.equal(loadCheckoutAttemptSeed(storage, now + 2), null);

  const next = await initializeCheckoutAttemptSeed(storage, now + 2, () =>
    "a".repeat(64),
  );
  assert.equal(next, null);
  assert.notEqual(loadCheckoutAttemptSeed(storage, now + 2)?.seed, used.seed);
});

test("success finalization preserves a different already-persisted attempt", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const used = await initializeCheckoutAttemptSeed(storage, now, () =>
    "b".repeat(64),
  );
  assert.ok(used);
  const newer = { ...used, seed: "c".repeat(64) };
  assert.equal(persistCheckoutAttemptSeed(newer, storage), true);

  assert.deepEqual(
    await finalizeCheckoutAttemptAfterSuccess(used, storage, now + 1, () =>
      "d".repeat(64),
    ),
    newer,
  );
  assert.deepEqual(loadCheckoutAttemptSeed(storage, now + 2), newer);
});

test("an older tab adopts durable state only when its attempt still matches", async () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const storage = new MemoryStorage();
  const first = await initializeCheckoutAttemptSeed(storage, now, () =>
    "d".repeat(64),
  );
  assert.ok(first);

  const refreshed = await prepareCheckoutAttemptSeedForSubmit(
    first,
    storage,
    now + 1,
  );
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.attempt.seed, first.seed);

  const replacement = { ...first, seed: "e".repeat(64) };
  assert.equal(persistCheckoutAttemptSeed(replacement, storage), true);
  assert.deepEqual(
    await prepareCheckoutAttemptSeedForSubmit(first, storage, now + 2),
    { ok: false, reason: "stale" },
  );
  assert.deepEqual(loadCheckoutAttemptSeed(storage, now + 2), replacement);

  const newTab = await prepareCheckoutAttemptSeedForSubmit(
    null,
    storage,
    now + 3,
  );
  assert.equal(newTab.ok, true);
  assert.equal(newTab.attempt.seed, replacement.seed);
});

test("unavailable browser storage never reports an attempt as durable", async () => {
  const unavailableStorage = {
    getItem() {
      throw new Error("storage unavailable");
    },
    setItem() {
      throw new Error("storage unavailable");
    },
    removeItem() {
      throw new Error("storage unavailable");
    },
  };
  const attempt = await initializeCheckoutAttemptSeed(
    unavailableStorage,
    Date.now(),
    () => "2".repeat(64),
  );

  assert.equal(attempt, null);
});

test("a failed seed write or read-back is never reported as durable", () => {
  const attempt = {
    version: 1,
    seed: "5".repeat(64),
    expiresAt: Date.now() + CHECKOUT_ATTEMPT_TTL_MS,
  };
  const writeFailure = new MemoryStorage();
  writeFailure.setItem = () => {
    throw new Error("write failed");
  };
  const readFailure = new MemoryStorage();
  readFailure.getItem = () => {
    throw new Error("read failed");
  };
  const silentDrop = new MemoryStorage();
  silentDrop.setItem = () => undefined;

  assert.equal(persistCheckoutAttemptSeed(attempt, writeFailure), false);
  assert.equal(persistCheckoutAttemptSeed(attempt, readFailure), false);
  assert.equal(persistCheckoutAttemptSeed(attempt, silentDrop), false);
});
