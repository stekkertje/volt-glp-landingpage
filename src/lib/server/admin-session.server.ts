import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

type AdminSessionPayload = {
  v: 1;
  exp: number;
  nonce: string;
};

function sessionSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function timingSafePasswordEqual(value: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(value).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function signAdminSession(secret: string, expiresAt: number): string {
  const payload: AdminSessionPayload = {
    v: 1,
    exp: expiresAt,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${sessionSignature(encoded, secret)}`;
}

export function verifyAdminSession(
  value: string | null | undefined,
  secret: string,
  now = Date.now(),
): boolean {
  if (!value || !secret) return false;
  const separator = value.lastIndexOf(".");
  if (separator < 1) return false;
  const payload = value.slice(0, separator);
  const providedSignature = value.slice(separator + 1);
  const expectedSignature = sessionSignature(payload, secret);
  const actual = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<AdminSessionPayload>;
    return (
      parsed.v === 1 &&
      typeof parsed.exp === "number" &&
      Number.isFinite(parsed.exp) &&
      parsed.exp > now &&
      typeof parsed.nonce === "string" &&
      parsed.nonce.length >= 16
    );
  } catch {
    return false;
  }
}
