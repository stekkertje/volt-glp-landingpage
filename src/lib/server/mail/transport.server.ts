import nodemailer, { type Transporter } from "nodemailer";
import {
  resolveMailConfiguration,
  type MailConfiguration,
  type MailEnvironment,
} from "@/lib/server/mail/config.server";

export type MailDelivery = {
  id: string;
  to: string;
  replyTo: string | null;
  subject: string;
  textBody: string;
  htmlBody: string;
};

type MailTransport = Transporter;

const globalMail = globalThis as typeof globalThis & {
  __voltMailTransport__?: MailTransport;
};

function transport(configuration: MailConfiguration): MailTransport {
  globalMail.__voltMailTransport__ ??= nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    auth: { user: configuration.user, pass: configuration.password },
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { servername: configuration.host, rejectUnauthorized: true },
  });
  return globalMail.__voltMailTransport__;
}

export async function deliverTransactionalMail(
  mail: MailDelivery,
  environment: MailEnvironment = process.env,
): Promise<{ providerMessageId: string | null }> {
  const configuration = resolveMailConfiguration(environment);
  if (!configuration) throw new Error("Mailtransport is niet geconfigureerd.");
  const result = await transport(configuration).sendMail({
    from: { name: configuration.fromName, address: configuration.fromAddress },
    to: mail.to,
    replyTo: mail.replyTo ?? undefined,
    subject: mail.subject,
    text: mail.textBody,
    html: mail.htmlBody,
    messageId: `<outbox-${mail.id}@afslank-injecties.nl>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const providerMessageId =
    typeof result.messageId === "string"
      ? result.messageId.slice(0, 500)
      : null;
  return { providerMessageId };
}

/** Non-mutating SMTP authentication/connection check for explicit operations. */
export async function verifySmtpConnection(
  environment: MailEnvironment = process.env,
): Promise<boolean> {
  const configuration = resolveMailConfiguration(environment);
  if (!configuration) return false;
  return transport(configuration).verify();
}
