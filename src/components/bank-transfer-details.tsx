import { BANK, formatIban } from "@/lib/bank";

export function BankTransferDetails({
  orderNumber,
  totalLabel,
}: {
  orderNumber?: string;
  totalLabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
        Betalen via overschrijving
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-muted">Naam</dt>
          <dd className="font-semibold">{BANK.accountName}</dd>
        </div>
        <div>
          <dt className="text-muted">IBAN</dt>
          <dd className="font-semibold tracking-wide">{formatIban(BANK.iban)}</dd>
        </div>
        <div>
          <dt className="text-muted">Land</dt>
          <dd>{BANK.country}</dd>
        </div>
        <div>
          <dt className="text-muted">Omschrijving</dt>
          <dd className="font-semibold">{orderNumber || "Je bestelnummer"}</dd>
        </div>
        {totalLabel ? (
          <div>
            <dt className="text-muted">Bedrag</dt>
            <dd className="font-extrabold text-primary">{totalLabel}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
