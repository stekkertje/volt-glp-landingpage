export const BANK = {
  accountName: "Totralink SRO",
  iban: "LT393190020101000706",
  country: "Litouwen",
  descriptionHint: "Bestelnummer",
} as const;

export function formatIban(iban: string): string {
  const compact = iban.replace(/\s+/g, "").toUpperCase();
  return compact.replace(/(.{4})/g, "$1 ").trim();
}
