import { Truck } from "lucide-react";

export function DeliveryPromise() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm">
      <Truck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold tracking-tight text-fg">
          Verzending na ontvangst betaling
        </p>
        <p className="text-xs text-muted">
          Overschrijving duurt meestal 24–48 uur. Daarna 1–2 werkdagen onderweg.
        </p>
      </div>
    </div>
  );
}
