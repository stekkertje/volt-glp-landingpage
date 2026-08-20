import type { TransactionalMailDraft } from "@/lib/server/mail/outbox.server";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function accountMailLayout(title: string, body: string): string {
  return `<!doctype html>
<html lang="nl">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;background:#f6f7f9;color:#17202a;font-family:Inter,Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e4e7eb;border-radius:16px">
          <tr><td style="padding:28px">
            <div style="color:#f06423;font-size:20px;font-weight:800">Afslank-injecties.nl</div>
            <h1 style="margin:20px 0 12px;font-size:24px;line-height:1.25">${escapeHtml(title)}</h1>
            ${body}
            <p style="margin:24px 0 0;color:#667085;font-size:13px;line-height:1.5">afslank-injecties.nl</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function actionButton(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return `<p style="margin:22px 0"><a href="${safeUrl}" style="display:inline-block;background:#f06423;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></p>
    <p style="margin:0;color:#667085;font-size:13px;line-height:1.5">Werkt de knop niet? Kopieer dan deze link:<br><span style="word-break:break-all">${safeUrl}</span></p>`;
}

export function accountVerificationMail(input: {
  dedupeKey: string;
  userId: string;
  email: string;
  name: string;
  url: string;
}): TransactionalMailDraft {
  const subject = "Bevestig je e-mailadres";
  const name = input.name.trim() || "klant";
  return {
    dedupeKey: input.dedupeKey,
    kind: "account_verify",
    userId: input.userId,
    to: input.email,
    subject,
    textBody: `Beste ${name},\n\nBevestig je e-mailadres om je account bij Afslank-injecties.nl te activeren:\n${input.url}\n\nDeze link is 1 uur geldig. Heb je dit account niet aangemaakt? Dan kun je deze e-mail negeren.`,
    htmlBody: accountMailLayout(
      subject,
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${escapeHtml(name)},</p>
       <p style="margin:0;line-height:1.6">Bevestig je e-mailadres om je account bij Afslank-injecties.nl te activeren.</p>
       ${actionButton("E-mailadres bevestigen", input.url)}
       <p style="margin:18px 0 0;color:#667085;font-size:13px;line-height:1.5">Deze link is 1 uur geldig. Heb je dit account niet aangemaakt? Dan kun je deze e-mail negeren.</p>`,
    ),
  };
}

export function passwordResetMail(input: {
  dedupeKey: string;
  userId: string;
  email: string;
  name: string;
  url: string;
}): TransactionalMailDraft {
  const subject = "Stel een nieuw wachtwoord in";
  const name = input.name.trim() || "klant";
  return {
    dedupeKey: input.dedupeKey,
    kind: "account_password_reset",
    userId: input.userId,
    to: input.email,
    subject,
    textBody: `Beste ${name},\n\nVia deze link kun je een nieuw wachtwoord instellen:\n${input.url}\n\nDeze link is 1 uur geldig. Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.`,
    htmlBody: accountMailLayout(
      subject,
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${escapeHtml(name)},</p>
       <p style="margin:0;line-height:1.6">Je hebt gevraagd om een nieuw wachtwoord in te stellen.</p>
       ${actionButton("Nieuw wachtwoord instellen", input.url)}
       <p style="margin:18px 0 0;color:#667085;font-size:13px;line-height:1.5">Deze link is 1 uur geldig. Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.</p>`,
    ),
  };
}

export function guestOrderClaimMail(input: {
  dedupeKey: string;
  userId: string;
  email: string;
  name: string;
  url: string;
}): TransactionalMailDraft {
  const subject = "Bevestig het koppelen van eerdere bestellingen";
  const name = input.name.trim() || "klant";
  return {
    dedupeKey: input.dedupeKey,
    kind: "guest_order_claim",
    userId: input.userId,
    to: input.email,
    subject,
    textBody: `Beste ${name},\n\nBevestig via deze link dat eerdere gastbestellingen met dit e-mailadres aan je account mogen worden gekoppeld:\n${input.url}\n\nDeze link is 30 minuten geldig en kan één keer worden gebruikt. Heb je dit niet aangevraagd? Dan hoef je niets te doen.`,
    htmlBody: accountMailLayout(
      subject,
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${escapeHtml(name)},</p>
       <p style="margin:0;line-height:1.6">Bevestig dat eerdere gastbestellingen met dit e-mailadres aan je account mogen worden gekoppeld.</p>
       ${actionButton("Bestellingen veilig koppelen", input.url)}
       <p style="margin:18px 0 0;color:#667085;font-size:13px;line-height:1.5">Deze link is 30 minuten geldig en kan één keer worden gebruikt. Heb je dit niet aangevraagd? Dan hoef je niets te doen.</p>`,
    ),
  };
}
