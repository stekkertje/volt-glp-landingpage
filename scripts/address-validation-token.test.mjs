import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "vite";

let vite;
let issueAddressValidationToken;
let verifyAddressValidationToken;
let AddressValidationTokenError;

const environment = {
  ORDER_ACCESS_TOKEN_SECRET:
    "address-validation-test-secret-with-more-than-32-characters",
};
const address = {
  street: "Koninklijk Park",
  houseNumber: "1 A",
  postcode: "7315 JA",
  city: "Apeldoorn",
  country: "NL",
};

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({
    issueAddressValidationToken,
    verifyAddressValidationToken,
    AddressValidationTokenError,
  } = await vite.ssrLoadModule(
    "/src/lib/server/address-validation-token.server.ts",
  ));
});

after(async () => {
  await vite?.close();
});

test("adresbewijs bindt provider en exact gekozen adres zonder persoonsgegevens", () => {
  const now = new Date("2026-08-20T10:00:00.000Z");
  const token = issueAddressValidationToken(
    { address, provider: "apicheck" },
    { now, environment },
  );
  assert.doesNotMatch(token, /Koninklijk|Apeldoorn|7315/);
  const verified = verifyAddressValidationToken(token, address, {
    now: new Date("2026-08-20T10:10:00.000Z"),
    environment,
  });
  assert.equal(verified.provider, "apicheck");
  assert.match(verified.fingerprint, /^[a-f0-9]{64}$/);
});

test("adresbewijs weigert adreswijziging, manipulatie en verlopen bewijs", () => {
  const now = new Date("2026-08-20T10:00:00.000Z");
  const token = issueAddressValidationToken(
    { address, provider: "apicheck" },
    { now, environment },
  );
  assert.throws(
    () =>
      verifyAddressValidationToken(
        token,
        { ...address, houseNumber: "2" },
        { now, environment },
      ),
    AddressValidationTokenError,
  );
  assert.throws(
    () =>
      verifyAddressValidationToken(`${token.slice(0, -1)}A`, address, {
        now,
        environment,
      }),
    AddressValidationTokenError,
  );
  assert.throws(
    () =>
      verifyAddressValidationToken(token, address, {
        now: new Date("2026-08-20T10:31:00.000Z"),
        environment,
      }),
    AddressValidationTokenError,
  );
});
