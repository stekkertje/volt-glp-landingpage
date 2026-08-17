import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { useCartStore } from "@/lib/cart-store";

export function Toasts() {
  const toasts = useCartStore((s) => s.toasts);
  const dismiss = useCartStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-24 right-3 z-[80] flex w-[min(100%-1.5rem,22rem)] flex-col gap-2 md:bottom-6 md:right-6"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const error = t.kind === "error";
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface p-3.5 shadow-lg shadow-fg/10 ${
              error ? "border-danger/30" : "border-border"
            }`}
            role={error ? "alert" : "status"}
          >
            {error ? (
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{t.message}</p>
              {t.detail && <p className="mt-0.5 text-xs text-muted">{t.detail}</p>}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-bg-elevated hover:text-fg"
              aria-label="Melding sluiten"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
