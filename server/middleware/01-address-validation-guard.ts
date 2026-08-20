import { resolveAddressValidationConfiguration } from "../../src/lib/server/integrations/address-validation-config.server";

// Nitro imports global middleware before routing. Persistent production must
// fail before checkout traffic is accepted when either provider key is absent.
resolveAddressValidationConfiguration(process.env);

export default function addressValidationGuard(
  _event: unknown,
  next: () => unknown | Promise<unknown>,
): unknown | Promise<unknown> {
  return next();
}
