import type { TransactionalMailDraft } from "@/lib/server/mail/outbox.server";
import {
  customerHelpCard,
  escapeHtml,
  mailActionButton,
  mailLayout,
} from "@/lib/server/mail/templates";

function actionButton(label: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return `<div style="margin-top:20px">${mailActionButton(label, url, 220)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8f9fb" style="width:100%;margin-top:16px;background:#f8f9fb;border-radius:10px">
      <tr><td style="padding:14px;font-size:12px;line-height:18px;color:#5b6170">Werkt de knop niet? Kopieer dan deze link:<br><span style="word-break:break-all;color:#0e7484">${safeUrl}</span></td></tr>
    </table>`;
}

function validityNotice(text: string): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef8fa" style="width:100%;margin-top:20px;background:#eef8fa;border-radius:10px">
    <tr><td style="padding:16px;font-size:13px;line-height:20px;color:#25414a">${escapeHtml(text)}</td></tr>
  </table>`;
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
    htmlBody: mailLayout(
      subject,
      `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${escapeHtml(name)},</p>
       <p style="margin:0;font-size:15px;line-height:23px;color:#303642">Bevestig je e-mailadres om je account bij Afslank-injecties.nl te activeren.</p>
       ${actionButton("E-mailadres bevestigen", input.url)}
       ${validityNotice("Deze link is 1 uur geldig. Heb je dit account niet aangemaakt? Dan kun je deze e-mail negeren.")}`,
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
    htmlBody: mailLayout(
      subject,
      `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${escapeHtml(name)},</p>
       <p style="margin:0;font-size:15px;line-height:23px;color:#303642">Je hebt gevraagd om een nieuw wachtwoord in te stellen.</p>
       ${actionButton("Nieuw wachtwoord instellen", input.url)}
       ${validityNotice("Deze link is 1 uur geldig. Heb je dit niet aangevraagd? Dan kun je deze e-mail negeren.")}`,
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
    htmlBody: mailLayout(
      subject,
      `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${escapeHtml(name)},</p>
       <p style="margin:0;font-size:15px;line-height:23px;color:#303642">Bevestig dat eerdere gastbestellingen met dit e-mailadres aan je account mogen worden gekoppeld.</p>
       ${actionButton("Bestellingen veilig koppelen", input.url)}
       ${validityNotice("Deze link is 30 minuten geldig en kan één keer worden gebruikt. Heb je dit niet aangevraagd? Dan hoef je niets te doen.")}
       ${customerHelpCard()}`,
    ),
  };
}
