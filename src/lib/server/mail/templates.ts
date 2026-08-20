import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import { formatEuro } from "@/lib/utils";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function layout(title: string, content: string): string {
  return `<!doctype html>
<html lang="nl">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
  <body style="margin:0;background:#f6f7f9;color:#17202a;font-family:Inter,Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(title)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:24px 12px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e4e7eb;border-radius:16px">
          <tr><td style="padding:28px">
            <div style="color:#f06423;font-size:20px;font-weight:800">Afslank-injecties.nl</div>
            <h1 style="margin:20px 0 12px;font-size:24px;line-height:1.25">${escapeHtml(title)}</h1>
            ${content}
            <p style="margin:24px 0 0;color:#667085;font-size:13px;line-height:1.5">afslank-injecties.nl</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export type RenderedMail = {
  subject: string;
  textBody: string;
  htmlBody: string;
};

type OrderMailLine = {
  name: string;
  optionLabel: string;
  qty: number;
};

type OrderMailAddress = {
  name: string;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  country: "NL" | "BE";
};

function plainOrderLines(lines: readonly OrderMailLine[]): string {
  return lines
    .map((line) => `${line.qty}x ${line.name} (${line.optionLabel})`)
    .join("\n");
}

function htmlOrderLines(lines: readonly OrderMailLine[]): string {
  return `<ul style="margin:0;padding-left:20px;line-height:1.7">${lines
    .map(
      (line) =>
        `<li>${line.qty}x ${escapeHtml(line.name)} (${escapeHtml(line.optionLabel)})</li>`,
    )
    .join("")}</ul>`;
}

function plainAddress(address: OrderMailAddress): string {
  return `${address.name}\n${address.street} ${address.houseNumber}\n${address.postcode} ${address.city}\n${address.country === "NL" ? "Nederland" : "België"}`;
}

function htmlAddress(address: OrderMailAddress): string {
  return `${escapeHtml(address.name)}<br>${escapeHtml(address.street)} ${escapeHtml(address.houseNumber)}<br>${escapeHtml(address.postcode)} ${escapeHtml(address.city)}<br>${address.country === "NL" ? "Nederland" : "België"}`;
}

export function orderCustomerConfirmationMail(input: {
  orderNumber: string;
  name: string;
  lines: readonly OrderMailLine[];
  totalCents: number;
  address: OrderMailAddress;
  hasAccount?: boolean;
}): RenderedMail {
  const subject = `Bevestiging van je bestelling ${input.orderNumber}`;
  const accountUrl = "https://afslank-injecties.nl/registreren";
  const accountText = input.hasAccount
    ? "Je vindt deze bestelling terug in je account."
    : `Wil je je bestelgeschiedenis bewaren? Maak een account met hetzelfde e-mailadres:\n${accountUrl}\nNa het inloggen kun je eerdere gastbestellingen via een veilige bevestigingslink aan je account koppelen.`;
  const accountHtml = input.hasAccount
    ? `<p style="margin:18px 0 0;line-height:1.6">Je vindt deze bestelling terug in je account.</p>`
    : `<p style="margin:18px 0 8px;line-height:1.6"><strong>Bestellingen in één account</strong></p>
       <p style="margin:0;line-height:1.6">Maak een account met hetzelfde e-mailadres. Na het inloggen kun je eerdere gastbestellingen via een veilige bevestigingslink koppelen.</p>
       <p style="margin:16px 0 0"><a href="${accountUrl}" style="display:inline-block;border-radius:10px;background:#f06423;color:#ffffff;padding:11px 16px;text-decoration:none;font-weight:700">Account aanmaken</a></p>`;
  return {
    subject,
    textBody: `Beste ${input.name},\n\nWe hebben je bestelling ${input.orderNumber} ontvangen.\n\n${plainOrderLines(input.lines)}\n\nTotaal bij bestelling: ${formatEuro(input.totalCents)}\n\nBezorgadres:\n${plainAddress(input.address)}\n\nHet bedrag dat bij het plaatsen van de bestelling is vastgelegd blijft leidend.\n\n${accountText}\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: layout(
      `Bestelling ${input.orderNumber} ontvangen`,
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0 0 18px;line-height:1.6">We hebben je bestelling ontvangen.</p>
       ${htmlOrderLines(input.lines)}
       <p style="margin:18px 0 0;line-height:1.6"><strong>Totaal bij bestelling:</strong> ${escapeHtml(formatEuro(input.totalCents))}</p>
       <p style="margin:18px 0 6px;line-height:1.6"><strong>Bezorgadres</strong></p>
       <p style="margin:0;line-height:1.6">${htmlAddress(input.address)}</p>
       <p style="margin:18px 0 0;color:#667085;font-size:13px;line-height:1.6">Het bedrag dat bij het plaatsen van de bestelling is vastgelegd blijft leidend.</p>
       ${accountHtml}`,
    ),
  };
}

export function orderOwnerConfirmationMail(input: {
  orderNumber: string;
  email: string;
  phone: string | null;
  lines: readonly OrderMailLine[];
  totalCents: number;
  address: OrderMailAddress;
}): RenderedMail {
  const subject = `Nieuwe bestelling ${input.orderNumber}`;
  const phone = input.phone ? `\nTelefoon: ${input.phone}` : "";
  return {
    subject,
    textBody: `Nieuwe bestelling ${input.orderNumber}\n\n${plainOrderLines(input.lines)}\n\nTotaal: ${formatEuro(input.totalCents)}\nE-mail: ${input.email}${phone}\n\nBezorgadres:\n${plainAddress(input.address)}`,
    htmlBody: layout(
      `Nieuwe bestelling ${input.orderNumber}`,
      `${htmlOrderLines(input.lines)}
       <p style="margin:18px 0 8px;line-height:1.6"><strong>Totaal:</strong> ${escapeHtml(formatEuro(input.totalCents))}</p>
       <p style="margin:0;line-height:1.6"><strong>E-mail:</strong> ${escapeHtml(input.email)}${input.phone ? `<br><strong>Telefoon:</strong> ${escapeHtml(input.phone)}` : ""}</p>
       <p style="margin:18px 0 6px;line-height:1.6"><strong>Bezorgadres</strong></p>
       <p style="margin:0;line-height:1.6">${htmlAddress(input.address)}</p>`,
    ),
  };
}

export function orderStatusChangedMail(input: {
  orderNumber: string;
  name: string;
  status: OrderStatus;
}): RenderedMail {
  const label = ORDER_STATUS_LABELS[input.status];
  const subject = `Status van bestelling ${input.orderNumber}: ${label}`;
  return {
    subject,
    textBody: `Beste ${input.name},\n\nDe status van je bestelling ${input.orderNumber} is gewijzigd naar: ${label}.\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: layout(
      `Status gewijzigd naar ${label}`,
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0;line-height:1.6">De status van bestelling <strong>${escapeHtml(input.orderNumber)}</strong> is gewijzigd naar <strong>${escapeHtml(label)}</strong>.</p>`,
    ),
  };
}

export function orderAddressChangedMail(input: {
  orderNumber: string;
  name: string;
  address: OrderMailAddress;
}): RenderedMail {
  const subject = `Bezorgadres van bestelling ${input.orderNumber} gewijzigd`;
  return {
    subject,
    textBody: `Beste ${input.name},\n\nHet bezorgadres voor bestelling ${input.orderNumber} is gewijzigd naar:\n\n${plainAddress(input.address)}\n\nHeb je deze wijziging niet verwacht? Neem dan contact met ons op.\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: layout(
      "Bezorgadres gewijzigd",
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0 0 12px;line-height:1.6">Het bezorgadres voor bestelling <strong>${escapeHtml(input.orderNumber)}</strong> is gewijzigd naar:</p>
       <p style="margin:0;line-height:1.6">${htmlAddress(input.address)}</p>
       <p style="margin:18px 0 0;color:#667085;font-size:13px;line-height:1.6">Heb je deze wijziging niet verwacht? Neem dan contact met ons op.</p>`,
    ),
  };
}

export function orderProductsChangedMail(input: {
  orderNumber: string;
  name: string;
  lines: readonly OrderMailLine[];
  paidTotalCents: number;
}): RenderedMail {
  const subject = `Producten van bestelling ${input.orderNumber} gewijzigd`;
  return {
    subject,
    textBody: `Beste ${input.name},\n\nDe te leveren producten voor bestelling ${input.orderNumber} zijn gewijzigd:\n\n${plainOrderLines(input.lines)}\n\nHet bij de bestelling vastgelegde bedrag van ${formatEuro(input.paidTotalCents)} blijft ongewijzigd.\n\nHeb je deze wijziging niet verwacht? Neem dan contact met ons op.\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: layout(
      "Producten gewijzigd",
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0 0 12px;line-height:1.6">De te leveren producten voor bestelling <strong>${escapeHtml(input.orderNumber)}</strong> zijn gewijzigd:</p>
       ${htmlOrderLines(input.lines)}
       <p style="margin:18px 0 0;line-height:1.6">Het bij de bestelling vastgelegde bedrag van <strong>${escapeHtml(formatEuro(input.paidTotalCents))}</strong> blijft ongewijzigd.</p>
       <p style="margin:18px 0 0;color:#667085;font-size:13px;line-height:1.6">Heb je deze wijziging niet verwacht? Neem dan contact met ons op.</p>`,
    ),
  };
}

export function contactOwnerMail(input: {
  name: string;
  email: string;
  message: string;
}): RenderedMail {
  const subject = "Nieuw contactbericht via afslank-injecties.nl";
  const safeName = escapeHtml(input.name);
  const safeEmail = escapeHtml(input.email);
  const safeMessage = escapeHtml(input.message).replaceAll("\n", "<br>");
  return {
    subject,
    textBody: `Nieuw contactbericht\n\nNaam: ${input.name}\nE-mail: ${input.email}\n\nBericht:\n${input.message}`,
    htmlBody: layout(
      "Nieuw contactbericht",
      `<p style="margin:0 0 8px;line-height:1.6"><strong>Naam:</strong> ${safeName}</p>
       <p style="margin:0 0 18px;line-height:1.6"><strong>E-mail:</strong> ${safeEmail}</p>
       <div style="padding:16px;border-radius:12px;background:#f6f7f9;line-height:1.6">${safeMessage}</div>`,
    ),
  };
}

export function contactCustomerReceiptMail(input: {
  name: string;
}): RenderedMail {
  const subject = "We hebben je bericht ontvangen";
  const safeName = escapeHtml(input.name);
  return {
    subject,
    textBody: `Beste ${input.name},\n\nBedankt voor je bericht. We hebben het goed ontvangen en reageren binnen 48 uur op werkdagen.\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: layout(
      "We hebben je bericht ontvangen",
      `<p style="margin:0 0 14px;line-height:1.6">Beste ${safeName},</p>
       <p style="margin:0 0 14px;line-height:1.6">Bedankt voor je bericht. We hebben het goed ontvangen.</p>
       <p style="margin:0;line-height:1.6"><strong>We reageren binnen 48 uur op werkdagen.</strong></p>
       <p style="margin:22px 0 0;line-height:1.6">Met vriendelijke groet,<br>Afslank-injecties.nl</p>`,
    ),
  };
}
