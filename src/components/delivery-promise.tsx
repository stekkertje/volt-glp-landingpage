import { useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { formatCountdown, isPastCutoff, msUntilCutoff } from "@/lib/cutoff";

export function DeliveryPromise() {
  const [ms, setMs] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const tick = () => {
      setClosed(isPastCutoff());
      setMs(msUntilCutoff());
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-bg-elevated px-3 py-2.5 text-sm">
      <Truck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0">
        {closed ? (
          <>
            <p className="font-semibold text-fg tracking-tight">
              Bestelvenster voor vandaag is gesloten
            </p>
            <p className="text-xs text-muted">Volgende verzending: eerstvolgende werkdag</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-fg tracking-tight">
              Bestel binnen{" "}
              <span className="tabular-nums text-primary">
                {ms === null ? "--:--:--" : formatCountdown(ms)}
              </span>
            </p>
            <p className="text-xs text-muted">Voor 23:00 besteld = morgen verzonden</p>
          </>
        )}
      </div>
    </div>
  );
}
