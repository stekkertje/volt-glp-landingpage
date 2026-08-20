const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export type MailEnvironment = Record<string, string | undefined>;

export type MailConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
  ownerAddress: string;
};

export class MailConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigurationError";
  }
}

export function resolveMailOwnerAddress(
  environment: MailEnvironment = process.env,
): string {
  return email(
    value(
      environment,
      "MAIL_OWNER_ADDRESS",
      "MAIL_FROM_ADDRESS",
      "SMTP_USER",
      "SMTP_USERNAME",
      "MAILBOX_ADDRESS",
    ) ?? "info@afslank-injecties.nl",
    "MAIL_OWNER_ADDRESS",
  );
}

function value(
  environment: MailEnvironment,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const result = environment[name]?.trim();
    if (result) return result;
  }
  return undefined;
}

function email(valueToValidate: string | undefined, label: string): string {
  if (
    !valueToValidate ||
    valueToValidate.includes("\r") ||
    valueToValidate.includes("\n") ||
    !EMAIL_PATTERN.test(valueToValidate)
  ) {
    throw new MailConfigurationError(`${label} bevat geen geldig e-mailadres.`);
  }
  return valueToValidate.toLowerCase();
}

function port(valueToValidate: string | undefined): number {
  if (!valueToValidate) return 465;
  if (!/^\d{1,5}$/.test(valueToValidate)) {
    throw new MailConfigurationError("SMTP_PORT moet een geldige poort zijn.");
  }
  const result = Number(valueToValidate);
  if (result < 1 || result > 65_535) {
    throw new MailConfigurationError("SMTP_PORT moet een geldige poort zijn.");
  }
  return result;
}

function secure(
  valueToValidate: string | undefined,
  smtpPort: number,
): boolean {
  if (!valueToValidate) return smtpPort === 465;
  const normalized = valueToValidate.toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new MailConfigurationError("SMTP_SECURE moet true/false of 1/0 zijn.");
}

/**
 * Resolve Hostinger SMTP settings without ever returning partial credentials.
 * An entirely absent SMTP setup disables delivery while preserving the DB
 * outbox, unless REQUIRE_MAIL=1 makes it mandatory. A partially configured
 * setup always fails closed with a non-secret error.
 */
export function resolveMailConfiguration(
  environment: MailEnvironment = process.env,
): MailConfiguration | null {
  const mailRequired = value(environment, "REQUIRE_MAIL") === "1";
  const user = value(
    environment,
    "SMTP_USER",
    "SMTP_USERNAME",
    "MAILBOX_ADDRESS",
  );
  const password = value(environment, "SMTP_PASSWORD", "MAILBOX_PASSWORD");
  const configuredValues = [
    user,
    password,
    value(environment, "SMTP_HOST"),
    value(environment, "SMTP_PORT"),
    value(environment, "SMTP_SECURE"),
    value(environment, "MAIL_FROM_ADDRESS"),
    value(environment, "MAIL_OWNER_ADDRESS"),
  ];

  if (configuredValues.every((item) => !item)) {
    if (mailRequired) {
      throw new MailConfigurationError(
        "SMTP-configuratie is verplicht wanneer REQUIRE_MAIL=1.",
      );
    }
    return null;
  }
  if (!user || !password) {
    throw new MailConfigurationError(
      "SMTP-gebruikersnaam en -wachtwoord moeten samen zijn ingesteld.",
    );
  }

  const smtpPort = port(value(environment, "SMTP_PORT"));
  const fromName = value(environment, "MAIL_FROM_NAME") ?? "VOLT";
  if (
    fromName.length > 120 ||
    fromName.includes("\r") ||
    fromName.includes("\n")
  ) {
    throw new MailConfigurationError("MAIL_FROM_NAME is ongeldig.");
  }

  const fromAddress = email(
    value(environment, "MAIL_FROM_ADDRESS") ?? user,
    "MAIL_FROM_ADDRESS",
  );

  return {
    host: value(environment, "SMTP_HOST") ?? "smtp.hostinger.com",
    port: smtpPort,
    secure: secure(value(environment, "SMTP_SECURE"), smtpPort),
    user,
    password,
    fromAddress,
    fromName,
    ownerAddress: resolveMailOwnerAddress(environment),
  };
}
