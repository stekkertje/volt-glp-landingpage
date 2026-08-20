import { createHash } from "node:crypto";

const RETAINED_BODY_PREFIX = "[inhoud-verwijderd:sha256:";

/**
 * Terminal outbox rows keep only a one-way content fingerprint. This preserves
 * strict dedupe-conflict detection without retaining reset, verification or
 * guest-claim URLs after SMTP may have accepted the message.
 */
export function retainedMailBodyFingerprint(body: string): string {
  const digest = createHash("sha256").update(body, "utf8").digest("hex");
  return `${RETAINED_BODY_PREFIX}${digest}]`;
}

export function retainedMailBodyMatches(
  storedBody: string,
  requestedBody: string,
): boolean {
  return (
    storedBody === requestedBody ||
    storedBody === retainedMailBodyFingerprint(requestedBody)
  );
}

export function scrubbedMailBodies(input: {
  textBody: string;
  htmlBody: string;
}): { textBody: string; htmlBody: string } {
  return {
    textBody: retainedMailBodyFingerprint(input.textBody),
    htmlBody: retainedMailBodyFingerprint(input.htmlBody),
  };
}
