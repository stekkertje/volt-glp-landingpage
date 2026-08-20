import { createHash } from "node:crypto";
import {
  IntegrationError,
  fetchWithTimeout,
  mapHttpStatus,
  readJsonObject,
  type HttpTransport,
} from "./integration-error";
import { resolveAddressValidationConfiguration } from "./address-validation-config.server";

export const EU_COUNTRY_CODES = [
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HU",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
] as const;

export type EuCountryCode = (typeof EU_COUNTRY_CODES)[number];
export type AddressValidationProvider = "apicheck" | "google";
export type AddressValidationStatus =
  | "valid"
  | "needs_confirmation"
  | "invalid"
  | "unavailable"
  | "unsupported_country";

export type PostalAddressInput = {
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  country: string;
};

export type NormalizedPostalAddress = {
  street: string;
  houseNumber: string;
  postcode: string;
  city: string;
  country: EuCountryCode;
  formattedAddress: string | null;
};

export type AddressValidationResult = {
  status: AddressValidationStatus;
  provider: AddressValidationProvider | null;
  normalizedAddress: NormalizedPostalAddress | null;
  changedFields: Array<"street" | "houseNumber" | "postcode" | "city">;
  issue:
    | "not_found"
    | "invalid_input"
    | "missing_component"
    | "unconfirmed_component"
    | "provider_error"
    | "unsupported_country"
    | null;
  retryable: boolean;
};

type ApiCheckData = {
  street?: unknown;
  number?: unknown;
  numberAddition?: unknown;
  postalcode?: unknown;
  city?: unknown;
  formattedAddress?: unknown;
};

type GoogleVerdict = {
  addressComplete?: unknown;
  hasUnconfirmedComponents?: unknown;
  possibleNextAction?: unknown;
};

type GooglePostalAddress = {
  regionCode?: unknown;
  postalCode?: unknown;
  locality?: unknown;
  addressLines?: unknown;
};

type GoogleComponent = {
  componentType?: unknown;
  componentName?: { text?: unknown };
  confirmationLevel?: unknown;
  inferred?: unknown;
};

export type AddressValidationServiceOptions = {
  apiCheckApiKey?: string;
  googleApiKey?: string;
  transport?: HttpTransport;
  timeoutMs?: number;
  apiCheckBaseUrl?: string;
  googleBaseUrl?: string;
  referer?: string;
};

const EU_COUNTRIES = new Set<string>(EU_COUNTRY_CODES);
const NL_POSTCODE = /^[1-9]\d{3}\s?[A-Z]{2}$/i;
const HOUSE_NUMBER = /^(\d+)(?:\s*(.*))?$/;

function safeText(value: unknown, max = 255): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text && text.length <= max ? text : null;
}

function normalizeComparable(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("nl-NL")
    .replace(/[^a-z0-9]/g, "");
}

function sameText(left: string, right: string): boolean {
  return normalizeComparable(left) === normalizeComparable(right);
}

function normalizeNlPostcode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  return compact.length === 6
    ? `${compact.slice(0, 4)} ${compact.slice(4)}`
    : value.trim().toUpperCase();
}

export function addressValidationFingerprint(
  address: PostalAddressInput | NormalizedPostalAddress,
): string {
  const canonical = [
    normalizeComparable(address.street),
    address.houseNumber.trim().toUpperCase().replace(/\s+/g, ""),
    address.postcode.trim().toUpperCase().replace(/\s+/g, ""),
    normalizeComparable(address.city),
    address.country.trim().toUpperCase(),
  ].join("\0");
  // Synchronous by design so callers can store it inside their order
  // transaction without another async boundary.
  return createHash("sha256").update(canonical).digest("hex");
}

export function splitHouseNumber(value: string): {
  number: string;
  addition: string | null;
} | null {
  const match = value.trim().match(HOUSE_NUMBER);
  if (!match) return null;
  const addition = match[2]?.trim() || null;
  return { number: match[1], addition };
}

function unavailable(
  provider: AddressValidationProvider,
  retryable: boolean,
): AddressValidationResult {
  return {
    status: "unavailable",
    provider,
    normalizedAddress: null,
    changedFields: [],
    issue: "provider_error",
    retryable,
  };
}

function changedFields(
  input: PostalAddressInput,
  normalized: NormalizedPostalAddress,
): AddressValidationResult["changedFields"] {
  const changed: AddressValidationResult["changedFields"] = [];
  if (!sameText(input.street, normalized.street)) changed.push("street");
  if (!sameText(input.houseNumber, normalized.houseNumber)) {
    changed.push("houseNumber");
  }
  if (!sameText(input.postcode, normalized.postcode)) changed.push("postcode");
  if (!sameText(input.city, normalized.city)) changed.push("city");
  return changed;
}

function integrationFailure(
  error: unknown,
  provider: AddressValidationProvider,
): AddressValidationResult {
  return unavailable(
    provider,
    error instanceof IntegrationError ? error.retryable : true,
  );
}

function componentText(
  components: GoogleComponent[],
  type: string,
): string | null {
  const component = components.find(
    (candidate) => candidate.componentType === type,
  );
  return safeText(component?.componentName?.text);
}

export function createAddressValidationService(
  options: AddressValidationServiceOptions,
) {
  const transport = options.transport ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const apiCheckBaseUrl = (
    options.apiCheckBaseUrl ?? "https://api.apicheck.nl"
  ).replace(/\/$/, "");
  const googleBaseUrl = (
    options.googleBaseUrl ?? "https://addressvalidation.googleapis.com"
  ).replace(/\/$/, "");

  async function validateWithApiCheck(
    input: PostalAddressInput,
  ): Promise<AddressValidationResult> {
    const key = options.apiCheckApiKey?.trim();
    if (!key) return unavailable("apicheck", false);

    const postcode = normalizeNlPostcode(input.postcode);
    const houseNumber = splitHouseNumber(input.houseNumber);
    if (!NL_POSTCODE.test(postcode) || !houseNumber) {
      return {
        status: "invalid",
        provider: "apicheck",
        normalizedAddress: null,
        changedFields: [],
        issue: "invalid_input",
        retryable: false,
      };
    }

    const url = new URL("/lookup/v1/address/nl", apiCheckBaseUrl);
    url.searchParams.set("postalcode", postcode.replace(/\s/g, ""));
    url.searchParams.set("number", houseNumber.number);
    if (houseNumber.addition) {
      url.searchParams.set("numberAddition", houseNumber.addition);
    }

    try {
      const response = await fetchWithTimeout(
        transport,
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-API-KEY": key,
            ...(options.referer ? { Referer: options.referer } : {}),
          },
        },
        timeoutMs,
        "apicheck",
      );
      if (response.status === 404 || response.status === 422) {
        return {
          status: "invalid",
          provider: "apicheck",
          normalizedAddress: null,
          changedFields: [],
          issue: "not_found",
          retryable: false,
        };
      }
      if (!response.ok) throw mapHttpStatus("apicheck", response.status);

      const body = await readJsonObject(response, "apicheck");
      if (body.error === true && body.name === "no_match") {
        return {
          status: "invalid",
          provider: "apicheck",
          normalizedAddress: null,
          changedFields: [],
          issue: "not_found",
          retryable: false,
        };
      }
      if (body.error === true) {
        throw new IntegrationError({
          provider: "apicheck",
          code: "remote_unavailable",
          retryable: true,
          httpStatus: response.status,
        });
      }
      const data = body.data as ApiCheckData | undefined;
      const street = safeText(data?.street, 120);
      const number = safeText(data?.number, 30);
      const addition = safeText(data?.numberAddition, 30);
      const officialPostcode = safeText(data?.postalcode, 16);
      const city = safeText(data?.city, 120);
      if (!street || !number || !officialPostcode || !city) {
        throw new IntegrationError({
          provider: "apicheck",
          code: "invalid_response",
          retryable: false,
          httpStatus: response.status,
        });
      }
      const normalized: NormalizedPostalAddress = {
        street,
        houseNumber: `${number}${addition ? ` ${addition}` : ""}`,
        postcode: normalizeNlPostcode(officialPostcode),
        city,
        country: "NL",
        formattedAddress: safeText(data?.formattedAddress, 500),
      };
      const changed = changedFields(input, normalized);
      return {
        status: changed.length > 0 ? "needs_confirmation" : "valid",
        provider: "apicheck",
        normalizedAddress: normalized,
        changedFields: changed,
        issue: changed.length > 0 ? "unconfirmed_component" : null,
        retryable: false,
      };
    } catch (error) {
      return integrationFailure(error, "apicheck");
    }
  }

  async function validateWithGoogle(
    input: PostalAddressInput,
    country: EuCountryCode,
  ): Promise<AddressValidationResult> {
    const key = options.googleApiKey?.trim();
    if (!key) return unavailable("google", false);
    if (
      !input.street.trim() ||
      input.street.trim().length > 120 ||
      !input.houseNumber.trim() ||
      input.houseNumber.trim().length > 30 ||
      !input.postcode.trim() ||
      input.postcode.trim().length > 16 ||
      !input.city.trim() ||
      input.city.trim().length > 120
    ) {
      return {
        status: "invalid",
        provider: "google",
        normalizedAddress: null,
        changedFields: [],
        issue: "invalid_input",
        retryable: false,
      };
    }

    try {
      const response = await fetchWithTimeout(
        transport,
        `${googleBaseUrl}/v1:validateAddress`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
          },
          body: JSON.stringify({
            address: {
              regionCode: country,
              postalCode: input.postcode.trim(),
              locality: input.city.trim(),
              addressLines: [
                `${input.street.trim()} ${input.houseNumber.trim()}`,
              ],
            },
          }),
        },
        timeoutMs,
        "google",
      );
      if (!response.ok) throw mapHttpStatus("google", response.status);
      const body = await readJsonObject(response, "google");
      const result = body.result as Record<string, unknown> | undefined;
      const verdict = result?.verdict as GoogleVerdict | undefined;
      const address = result?.address as Record<string, unknown> | undefined;
      const postalAddress = address?.postalAddress as
        GooglePostalAddress | undefined;
      const components = Array.isArray(address?.addressComponents)
        ? (address.addressComponents as GoogleComponent[])
        : [];
      const route = componentText(components, "route");
      const streetNumber = componentText(components, "street_number");
      const subpremise = componentText(components, "subpremise");
      const addressLines = Array.isArray(postalAddress?.addressLines)
        ? postalAddress.addressLines.filter(
            (line): line is string => typeof line === "string",
          )
        : [];
      const normalizedStreet = route ?? input.street.trim();
      const normalizedNumber = streetNumber
        ? `${streetNumber}${subpremise ? ` ${subpremise}` : ""}`
        : input.houseNumber.trim();
      const normalizedPostcode = safeText(postalAddress?.postalCode, 16);
      const normalizedCity = safeText(postalAddress?.locality, 120);
      const normalizedCountry = safeText(
        postalAddress?.regionCode,
        2,
      )?.toUpperCase();
      if (
        !normalizedPostcode ||
        !normalizedCity ||
        normalizedCountry !== country ||
        !address
      ) {
        throw new IntegrationError({
          provider: "google",
          code: "invalid_response",
          retryable: false,
          httpStatus: response.status,
        });
      }
      const normalized: NormalizedPostalAddress = {
        street: normalizedStreet,
        houseNumber: normalizedNumber,
        postcode: normalizedPostcode,
        city: normalizedCity,
        country,
        formattedAddress:
          safeText(address.formattedAddress, 500) ??
          (addressLines.join(", ") || null),
      };
      const missingComponents = Array.isArray(address.missingComponentTypes)
        ? address.missingComponentTypes
        : [];
      const unconfirmedComponents = Array.isArray(
        address.unconfirmedComponentTypes,
      )
        ? address.unconfirmedComponentTypes
        : [];
      const nextAction = safeText(verdict?.possibleNextAction, 64);
      const complete = verdict?.addressComplete === true;
      const hasUnconfirmed =
        verdict?.hasUnconfirmedComponents === true ||
        unconfirmedComponents.length > 0 ||
        !route ||
        !streetNumber;
      const changed = changedFields(input, normalized);

      if (missingComponents.length > 0 || nextAction === "FIX") {
        return {
          status: "invalid",
          provider: "google",
          normalizedAddress: normalized,
          changedFields: changed,
          issue: "missing_component",
          retryable: false,
        };
      }
      const needsConfirmation =
        !complete ||
        hasUnconfirmed ||
        changed.length > 0 ||
        (nextAction !== null && nextAction !== "ACCEPT");
      return {
        status: needsConfirmation ? "needs_confirmation" : "valid",
        provider: "google",
        normalizedAddress: normalized,
        changedFields: changed,
        issue: needsConfirmation ? "unconfirmed_component" : null,
        retryable: false,
      };
    } catch (error) {
      return integrationFailure(error, "google");
    }
  }

  return {
    async validate(
      input: PostalAddressInput,
    ): Promise<AddressValidationResult> {
      const country = input.country.trim().toUpperCase();
      if (!EU_COUNTRIES.has(country)) {
        return {
          status: "unsupported_country",
          provider: null,
          normalizedAddress: null,
          changedFields: [],
          issue: "unsupported_country",
          retryable: false,
        };
      }
      return country === "NL"
        ? validateWithApiCheck(input)
        : validateWithGoogle(input, country as EuCountryCode);
    },
  };
}

export function createAddressValidationServiceFromEnv(
  overrides: Omit<
    AddressValidationServiceOptions,
    "apiCheckApiKey" | "googleApiKey"
  > = {},
) {
  const configuration = resolveAddressValidationConfiguration(process.env);
  return createAddressValidationService({
    ...overrides,
    apiCheckApiKey: configuration.apiCheckApiKey,
    googleApiKey: configuration.googleApiKey,
    apiCheckBaseUrl: overrides.apiCheckBaseUrl ?? process.env.APICHECK_BASE_URL,
    googleBaseUrl:
      overrides.googleBaseUrl ?? process.env.GOOGLE_ADDRESS_VALIDATION_BASE_URL,
  });
}
