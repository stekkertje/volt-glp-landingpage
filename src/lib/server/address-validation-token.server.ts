import { createHmac, timingSafeEqual } from "node:crypto";
import {
  addressValidationFingerprint,
  type AddressValidationProvider,
  type PostalAddressInput,
} from "@/lib/server/integrations/address-validation.server";

const TOKEN_VERSION = 1;
const TOKEN_CONTEXT = "volt-address-validation";
const TOKEN_TTL_MS = 30 * 60 * 1_000;
const MIN_SECRET_LENGTH = 32;

type AddressValidationTokenPayload = {
  v: typeof TOKEN_VERSION;
  fingerprint: string;
  provider: AddressValidationProvider;
  expiresAt: number;
};

export type VerifiedAddressValidation = {
  fingerprint: string;
  provider: AddressValidationProvider;
  validatedAt: Date;
};

export class AddressValidationTokenError extends Error {
  readonly status = 400;

  constructor() {
    super("Controleer het bezorgadres opnieuw.");
    this.name = "AddressValidationTokenError";
  }
}

function secret(environment: NodeJS.ProcessEnv = process.env): string {
  const value =
    environment.ADDRESS_VALIDATION_TOKEN_SECRET?.trim() ||
    environment.ORDER_ACCESS_TOKEN_SECRET?.trim() ||
    environment.BETTER_AUTH_SECRET?.trim();
  if (!value || value.length < MIN_SECRET_LENGTH) {
    throw new Error("Adresvalidatiegeheim ontbreekt of is te kort.");
  }
  return value;
}

function signature(encodedPayload: string, key: string): Buffer {
  return createHmac("sha256", key)
    .update(TOKEN_CONTEXT)
    .update("\0")
    .update(encodedPayload)
    .digest();
}

function safePayload(raw: string): AddressValidationTokenPayload | null {
  try {
    const decoded = Buffer.from(raw, "base64url");
    if (decoded.toString("base64url") !== raw) return null;
    const value: unknown = JSON.parse(decoded.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const payload = value as Partial<AddressValidationTokenPayload>;
    if (
      payload.v !== TOKEN_VERSION ||
      !/^[a-f0-9]{64}$/.test(payload.fingerprint ?? "") ||
      !["apicheck", "google"].includes(payload.provider ?? "") ||
      !Number.isSafeInteger(payload.expiresAt) ||
      (payload.expiresAt ?? 0) <= 0
    ) {
      return null;
    }
    return payload as AddressValidationTokenPayload;
  } catch {
    return null;
  }
}

export function issueAddressValidationToken(
  input: {
    address: PostalAddressInput;
    provider: AddressValidationProvider;
  },
  options: {
    now?: Date;
    environment?: NodeJS.ProcessEnv;
  } = {},
): string {
  const now = options.now ?? new Date();
  const payload: AddressValidationTokenPayload = {
    v: TOKEN_VERSION,
    fingerprint: addressValidationFingerprint(input.address),
    provider: input.provider,
    expiresAt: now.getTime() + TOKEN_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const encodedSignature = signature(
    encodedPayload,
    secret(options.environment),
  ).toString("base64url");
  return `${encodedPayload}.${encodedSignature}`;
}

export function verifyAddressValidationToken(
  token: string,
  address: PostalAddressInput,
  options: {
    now?: Date;
    environment?: NodeJS.ProcessEnv;
  } = {},
): VerifiedAddressValidation {
  const [encodedPayload, encodedSignature, extra] = token.trim().split(".");
  if (!encodedPayload || !encodedSignature || extra) {
    throw new AddressValidationTokenError();
  }
  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
  } catch {
    throw new AddressValidationTokenError();
  }
  if (suppliedSignature.toString("base64url") !== encodedSignature) {
    throw new AddressValidationTokenError();
  }
  const expectedSignature = signature(
    encodedPayload,
    secret(options.environment),
  );
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new AddressValidationTokenError();
  }
  const payload = safePayload(encodedPayload);
  const now = options.now ?? new Date();
  if (
    !payload ||
    payload.expiresAt < now.getTime() ||
    payload.expiresAt > now.getTime() + TOKEN_TTL_MS + 60_000 ||
    payload.fingerprint !== addressValidationFingerprint(address)
  ) {
    throw new AddressValidationTokenError();
  }
  return {
    fingerprint: payload.fingerprint,
    provider: payload.provider,
    validatedAt: now,
  };
}
