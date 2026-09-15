export const SCRUBBED_MAIL_TEXT_BODY =
  "[Mailinhoud verwijderd na definitieve afhandeling.]";
export const SCRUBBED_MAIL_HTML_BODY =
  "<p>Mailinhoud verwijderd na definitieve afhandeling.</p>";

export function mailBodiesAreScrubbed(input: {
  textBody: string;
  htmlBody: string;
}): boolean {
  return (
    input.textBody === SCRUBBED_MAIL_TEXT_BODY &&
    input.htmlBody === SCRUBBED_MAIL_HTML_BODY
  );
}

/**
 * Before terminal delivery, body equality remains part of strict dedupe
 * validation. Afterwards the unique dedupe key is authoritative: no body or
 * token-derived fingerprint is retained, and a replay can never be sent again.
 */
export function retainedMailBodiesMatch(input: {
  storedTextBody: string;
  storedHtmlBody: string;
  requestedTextBody: string;
  requestedHtmlBody: string;
}): boolean {
  return (
    mailBodiesAreScrubbed({
      textBody: input.storedTextBody,
      htmlBody: input.storedHtmlBody,
    }) ||
    (input.storedTextBody === input.requestedTextBody &&
      input.storedHtmlBody === input.requestedHtmlBody)
  );
}

export function scrubbedMailBodies(): { textBody: string; htmlBody: string } {
  return {
    textBody: SCRUBBED_MAIL_TEXT_BODY,
    htmlBody: SCRUBBED_MAIL_HTML_BODY,
  };
}
