import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/order-status";
import { getProduct } from "@/lib/product";
import { formatEuro } from "@/lib/utils";

const SITE_URL = "https://afslank-injecties.nl";
// Vervang dit door de directe hulplink zodra de klantondersteuning live staat.
const CUSTOMER_SUPPORT_URL = SITE_URL;

export const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export function mailLayout(
  title: string,
  content: string,
): string {
  return `<!doctype html>
<html lang="nl">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f4f5f7;color:#0b0c0f;font-family:Arial,sans-serif">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(title)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4f5f7" style="width:100%;background:#f4f5f7">
      <tr>
        <td align="center" style="padding:24px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e6e8ec;border-radius:14px;overflow:hidden">
            <tr>
              <td style="padding:0;border-bottom:1px solid #e6e8ec">
                <a href="${SITE_URL}" style="display:block;padding:20px 24px;color:#0b0c0f;text-decoration:none">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td width="42" valign="middle" style="width:42px">
                        <div style="width:34px;height:34px;line-height:34px;border-radius:8px;background:#0e7484;color:#ffffff;font-size:14px;font-weight:700;text-align:center">A</div>
                      </td>
                      <td valign="middle" style="font-size:18px;line-height:24px;font-weight:700;color:#0b0c0f">Afslank-injecties.nl</td>
                    </tr>
                  </table>
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px 30px">
                <h1 style="margin:0 0 20px;font-size:26px;line-height:32px;font-weight:700;letter-spacing:-0.3px;color:#0b0c0f">${escapeHtml(title)}</h1>
                ${content}
              </td>
            </tr>
            <tr>
              <td bgcolor="#0b0c0f" style="padding:18px 24px;background:#0b0c0f">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td width="40" valign="middle" style="width:40px">
                      <div style="width:30px;height:30px;line-height:30px;border-radius:7px;background:#0e7484;color:#ffffff;font-size:12px;font-weight:700;text-align:center">A</div>
                    </td>
                    <td valign="middle">
                      <div style="font-size:13px;line-height:18px;font-weight:700;color:#ffffff">Afslank-injecties.nl</div>
                      <div style="font-size:11px;line-height:16px;color:#b9c0ca">Afslanken met injecties</div>
                    </td>
                    <td valign="middle" align="right" style="padding-left:10px">
                      <a href="${SITE_URL}" style="display:inline-block;border:1px solid #38404a;border-radius:7px;color:#ffffff;padding:8px 11px;text-decoration:none;font-size:11px;line-height:15px;font-weight:700;white-space:nowrap">Bezoek website</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export type RenderedMail = {
  subject: string;
  textBody: string;
  htmlBody: string;
};

export function mailActionButton(
  label: string,
  url: string,
  width = 200,
): string {
  return `<table role="presentation" width="${width}" cellspacing="0" cellpadding="0" border="0" style="width:${width}px">
    <tr><td width="${width}" align="center" bgcolor="#0e7484" style="width:${width}px;border-radius:8px"><a href="${escapeHtml(url)}" style="display:block;color:#ffffff;padding:11px 8px;text-decoration:none;font-size:14px;line-height:18px;font-weight:700">${escapeHtml(label)}</a></td></tr>
  </table>`;
}

export function customerHelpCard(): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8f9fb" style="width:100%;margin-top:22px;background:#f8f9fb;border-radius:10px">
    <tr>
      <td valign="top" style="padding:16px 8px 16px 16px">
        <div style="font-size:14px;line-height:20px;font-weight:700;color:#0b0c0f">Hulp of een vraag?</div>
        <div style="margin-top:3px;font-size:13px;line-height:20px;color:#5b6170">We helpen je graag met vragen over je bestelling, verzending, account of een product.</div>
        <div style="margin-top:14px">${mailActionButton("Contact opnemen", CUSTOMER_SUPPORT_URL, 160)}</div>
      </td>
      <td width="54" valign="top" align="right" style="width:54px;padding:16px 16px 16px 0">
        <img src="${SITE_URL}/images/mail/ai-support.png" width="36" height="36" alt="Hulp en contact" style="display:block;width:36px;height:36px;border:0">
      </td>
    </tr>
  </table>`;
}

function orderSummaryCard(
  orderNumber: string,
  secondaryLabel: string,
  secondaryValue: string,
): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-bottom:24px;border:1px solid #e6e8ec;border-radius:10px">
    <tr>
      <td width="50%" valign="top" style="width:50%;padding:14px 16px;border-right:1px solid #e6e8ec">
        <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#5b6170">Bestelnummer</div>
        <div style="margin-top:3px;font-size:15px;line-height:21px;font-weight:700;color:#0b0c0f">${escapeHtml(orderNumber)}</div>
      </td>
      <td width="50%" valign="top" style="width:50%;padding:14px 16px">
        <div style="font-size:11px;line-height:16px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#5b6170">${escapeHtml(secondaryLabel)}</div>
        <div style="margin-top:3px;font-size:15px;line-height:21px;font-weight:700;color:#0b0c0f">${escapeHtml(secondaryValue)}</div>
      </td>
    </tr>
  </table>`;
}

function infoCard(content: string, marginTop = 0): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8f9fb" style="width:100%;margin-top:${marginTop}px;background:#f8f9fb;border-radius:10px">
    <tr><td style="padding:16px;font-size:14px;line-height:21px;color:#303642">${content}</td></tr>
  </table>`;
}

type OrderMailLine = {
  name: string;
  optionLabel: string;
  qty: number;
  slug?: string;
  lineTotalCents?: number;
};

type OrderMailAddress = {
  name: string;
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  country: "NL" | "BE";
};

function plainDetailedOrderLines(lines: readonly OrderMailLine[]): string {
  return lines
    .map(
      (line) =>
        `${line.qty}x ${line.name} (${line.optionLabel})${typeof line.lineTotalCents === "number" ? ` - ${formatEuro(line.lineTotalCents)}` : ""}`,
    )
    .join("\n");
}

function htmlConfirmationOrderLines(
  lines: readonly OrderMailLine[],
): string {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse">${lines
    .map((line, index) => {
      const product = getProduct(line.slug);
      const image = product?.images[0];
      const imageHtml = image
        ? `<img src="${SITE_URL}${escapeHtml(image.src)}" width="64" height="64" alt="${escapeHtml(image.alt)}" style="display:block;width:64px;height:64px;object-fit:cover;border:1px solid #e6e8ec;border-radius:9px">`
        : `<div style="width:64px;height:64px;border:1px solid #e6e8ec;border-radius:9px;background:#f8f9fb"></div>`;
      const lineTotal =
        typeof line.lineTotalCents === "number"
          ? escapeHtml(formatEuro(line.lineTotalCents))
          : "";
      const paddingTop = index === 0 ? "0" : "14px";
      const paddingBottom = index === lines.length - 1 ? "0" : "14px";
      const borderBottom =
        index === lines.length - 1 ? "0" : "1px solid #e6e8ec";

      return `<tr>
          <td width="76" valign="middle" style="width:76px;padding:${paddingTop} 0 ${paddingBottom};border-bottom:${borderBottom}">${imageHtml}</td>
          <td valign="middle" style="padding:${paddingTop} 8px ${paddingBottom} 0;border-bottom:${borderBottom}">
            <div style="font-size:15px;line-height:20px;font-weight:700;color:#0b0c0f">${escapeHtml(line.name)}</div>
            <div style="margin-top:3px;font-size:13px;line-height:18px;color:#5b6170">${line.qty} × ${escapeHtml(line.optionLabel)}</div>
          </td>
          <td width="82" valign="middle" align="right" style="width:82px;padding:${paddingTop} 0 ${paddingBottom};border-bottom:${borderBottom};font-size:14px;line-height:20px;font-weight:700;color:#0b0c0f;white-space:nowrap">${lineTotal}</td>
        </tr>`;
    })
    .join("")}</table>`;
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
    : `Wil je je bestellingen bewaren? Maak een account met hetzelfde e-mailadres:\n${accountUrl}`;
  const accountHtml = input.hasAccount
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef8fa" style="width:100%;margin-top:22px;background:#eef8fa;border-radius:10px">
         <tr><td style="padding:16px;color:#25414a;font-size:14px;line-height:21px">Je vindt deze bestelling terug in je account.</td></tr>
       </table>`
    : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#eef8fa" style="width:100%;margin-top:22px;background:#eef8fa;border-radius:10px">
         <tr>
           <td style="padding:18px">
             <div style="font-size:15px;line-height:21px;font-weight:700;color:#0b0c0f">Je bestellingen bewaren?</div>
             <div style="margin-top:5px;font-size:14px;line-height:21px;color:#25414a">Maak een account met hetzelfde e-mailadres.</div>
             <div style="margin-top:14px">${mailActionButton("Account aanmaken", accountUrl, 160)}</div>
           </td>
         </tr>
       </table>`;
  return {
    subject,
    textBody: `Beste ${input.name},\n\nBedankt voor je bestelling. We hebben deze goed ontvangen.\n\nBestelnummer: ${input.orderNumber}\n\nProducten:\n${plainDetailedOrderLines(input.lines)}\n\nTotaal bij bestelling: ${formatEuro(input.totalCents)}\n\nBezorgadres:\n${plainAddress(input.address)}\n\n${accountText}\n\nHulp nodig? Neem contact met ons op voor vragen over je bestelling, verzending of producten:\n${CUSTOMER_SUPPORT_URL}\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: mailLayout(
      "Bedankt voor je bestelling",
      `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#303642">We hebben je bestelling goed ontvangen.</p>
       ${orderSummaryCard(input.orderNumber, "Totaal", formatEuro(input.totalCents))}
       <h2 style="margin:0 0 14px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Producten</h2>
       ${htmlConfirmationOrderLines(input.lines)}
       <h2 style="margin:26px 0 10px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Bezorgadres</h2>
       <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f8f9fb" style="width:100%;background:#f8f9fb;border-radius:10px">
         <tr><td style="padding:16px;font-size:14px;line-height:21px;color:#303642">${htmlAddress(input.address)}</td></tr>
       </table>
       ${accountHtml}
       ${customerHelpCard()}`,
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
    textBody: `Nieuwe bestelling ${input.orderNumber}\n\nProducten:\n${plainDetailedOrderLines(input.lines)}\n\nTotaal: ${formatEuro(input.totalCents)}\n\nKlantgegevens:\nE-mail: ${input.email}${phone}\n\nBezorgadres:\n${plainAddress(input.address)}`,
    htmlBody: mailLayout(
      "Nieuwe bestelling ontvangen",
      `<p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#303642">Er is een nieuwe bestelling geplaatst.</p>
       ${orderSummaryCard(input.orderNumber, "Totaal", formatEuro(input.totalCents))}
       <h2 style="margin:0 0 14px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Producten</h2>
       ${htmlConfirmationOrderLines(input.lines)}
       <h2 style="margin:26px 0 10px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Klantgegevens</h2>
       ${infoCard(`<strong>E-mail:</strong> ${escapeHtml(input.email)}${input.phone ? `<br><strong>Telefoon:</strong> ${escapeHtml(input.phone)}` : ""}`)}
       <h2 style="margin:26px 0 10px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Bezorgadres</h2>
       ${infoCard(htmlAddress(input.address))}`,
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
    textBody: `Beste ${input.name},\n\nDe status van je bestelling ${input.orderNumber} is gewijzigd naar: ${label}.\n\nHulp nodig? Neem contact met ons op:\n${CUSTOMER_SUPPORT_URL}\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: mailLayout(
      "Status van je bestelling",
      `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#303642">De status van je bestelling is bijgewerkt.</p>
       ${orderSummaryCard(input.orderNumber, "Nieuwe status", label)}
       ${customerHelpCard()}`,
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
    textBody: `Beste ${input.name},\n\nHet bezorgadres voor bestelling ${input.orderNumber} is gewijzigd naar:\n\n${plainAddress(input.address)}\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: mailLayout(
      "Bezorgadres gewijzigd",
      `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#303642">Het bezorgadres van je bestelling is bijgewerkt.</p>
       ${orderSummaryCard(input.orderNumber, "Wijziging", "Bezorgadres")}
       <h2 style="margin:0 0 10px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Nieuw bezorgadres</h2>
       ${infoCard(htmlAddress(input.address))}
       ${customerHelpCard()}`,
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
    textBody: `Beste ${input.name},\n\nDe te leveren producten voor bestelling ${input.orderNumber} zijn gewijzigd:\n\n${plainDetailedOrderLines(input.lines)}\n\nMet vriendelijke groet,\nAfslank-injecties.nl`,
    htmlBody: mailLayout(
      "Producten gewijzigd",
       `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${escapeHtml(input.name)},</p>
       <p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#303642">De te leveren producten van je bestelling zijn bijgewerkt.</p>
       ${orderSummaryCard(input.orderNumber, "Wijziging", "Producten")}
       <h2 style="margin:0 0 14px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Nieuwe productsamenstelling</h2>
       ${htmlConfirmationOrderLines(input.lines)}
       ${customerHelpCard()}`,
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
    htmlBody: mailLayout(
      "Nieuw contactbericht",
      `<p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#303642">Er is een nieuw bericht via het contactformulier ontvangen.</p>
       <h2 style="margin:0 0 10px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Contactgegevens</h2>
       ${infoCard(`<strong>Naam:</strong> ${safeName}<br><strong>E-mail:</strong> ${safeEmail}`)}
       <h2 style="margin:26px 0 10px;font-size:17px;line-height:23px;font-weight:700;color:#0b0c0f">Bericht</h2>
       ${infoCard(safeMessage)}`,
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
    htmlBody: mailLayout(
      "We hebben je bericht ontvangen",
      `<p style="margin:0 0 6px;font-size:15px;line-height:23px;color:#303642">Beste ${safeName},</p>
       <p style="margin:0 0 22px;font-size:15px;line-height:23px;color:#303642">Bedankt voor je bericht. We hebben het goed ontvangen.</p>
       ${infoCard("<strong>Wanneer hoor je van ons?</strong><br>We reageren binnen 48 uur op werkdagen.")}`,
    ),
  };
}
