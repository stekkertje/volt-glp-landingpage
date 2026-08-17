import { useEffect, useState } from "react";
import { Truck } from "lucide-react";

function pastCutoff(now = new Date()) {
  return now.getHours() >= 23;
}

function msUntilCutoff() {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setHours(23, 0, 0, 0);
  if (now >= cutoff) return 0;
  return cutoff.getTime() - now.getTime();
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function DeliveryPromise() {
  const [ms, setMs] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const tick = () => {
      setClosed(pastCutoff());
      setMs(msUntilCutoff());
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
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
            <p className="text-xs text-muted">
              Volgende verzending: eerstvolgende werkdag
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold text-fg tracking-tight">
              Bestel binnen{" "}
              <span className="tabular-nums text-primary">
                {ms === null ? "--:--:--" : formatCountdown(ms)}
              </span>
            </p>
            <p className="text-xs text-muted">
              Voor 23:00 besteld = volgende werkdag verzonden
            </p>
          </>
        )}
      </div>
    </div>
  );
}
