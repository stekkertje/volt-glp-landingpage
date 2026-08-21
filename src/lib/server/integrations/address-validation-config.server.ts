export type AddressValidationEnvironment = Record<string, string | undefined>;

export type AddressValidationConfiguration = {
  apiCheckApiKey: string | undefined;
  googleApiKey: string | undefined;
};

export class AddressValidationConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressValidationConfigurationError";
  }
}

function value(
  environment: AddressValidationEnvironment,
  name: string,
): string | undefined {
  return environment[name]?.trim() || undefined;
}

/**
 * Production checkout needs both providers: ApiCheck serves NL and Google the
 * other supported EU addresses. Persistent production and explicitly guarded
 * runtimes fail during bootstrap instead of discovering missing keys at
 * checkout. Error messages contain variable names only, never secret values.
 */
export function resolveAddressValidationConfiguration(
  environment: AddressValidationEnvironment = process.env,
): AddressValidationConfiguration {
  const apiCheckApiKey = value(environment, "APICHECK_API_KEY");
  const googleApiKey = value(environment, "GOOGLE_ADDRESS_VALIDATION_API_KEY");
  const required =
    value(environment, "REQUIRE_ADDRESS_VALIDATION") === "1" ||
    (value(environment, "NODE_ENV") === "production" &&
      value(environment, "REQUIRE_DATABASE") === "1");
  if (required && (!apiCheckApiKey || !googleApiKey)) {
    const missing = [
      !apiCheckApiKey ? "APICHECK_API_KEY" : null,
      !googleApiKey ? "GOOGLE_ADDRESS_VALIDATION_API_KEY" : null,
    ].filter((name): name is string => name !== null);
    throw new AddressValidationConfigurationError(
      `Adresvalidatieconfiguratie ontbreekt: ${missing.join(", ")}.`,
    );
  }
  return { apiCheckApiKey, googleApiKey };
}
