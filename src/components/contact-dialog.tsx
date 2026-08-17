import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { X, Loader2, Mail } from "lucide-react";
import { useContactStore } from "@/lib/contact-store";
import { useCartStore } from "@/lib/cart-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export function ContactDialog() {
  const open = useContactStore((s) => s.open);
  const close = useContactStore((s) => s.closeContact);
  const pushToast = useCartStore((s) => s.pushToast);
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    email?: string;
    message?: string;
  }>({});

  useDialogFocus(open, close, dialogRef);

  useEffect(() => {
    if (!open) {
      setName("");
      setEmail("");
      setMessage("");
      setErrors({});
      setSending(false);
    }
  }, [open]);

  if (!open) return null;

  const validate = () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = "Vul je naam in";
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Vul een geldig e-mailadres in";
    }
    if (!message.trim() || message.trim().length < 10) {
      next.message = "Schrijf minimaal 10 tekens";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSending(true);
    // Demo: no backend — confirm to user and close
    window.setTimeout(() => {
      setSending(false);
      close();
      pushToast("Bericht verstuurd", "We reageren binnen 24 uur op werkdagen.");
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-fg/45 backdrop-blur-[2px]"
        aria-label="Sluiten"
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative z-10 flex max-h-[min(92vh,640px)] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:max-w-md sm:rounded-2xl",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Mail className="size-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-base font-extrabold tracking-tight text-fg"
              >
                Contact
              </h2>
              <p className="text-xs text-muted">
                Reactie binnen 24 uur op werkdagen
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-muted hover:text-fg"
            aria-label="Sluiten"
          >
            <X className="size-4" />
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="contact-name"
              className="text-xs font-semibold text-fg"
            >
              Naam
            </label>
            <input
              id="contact-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (errors.name)
                  setErrors((current) => ({ ...current, name: undefined }));
              }}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2"
              placeholder="Je naam"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={
                errors.name ? `${titleId}-name-error` : undefined
              }
              data-dialog-autofocus
            />
            {errors.name && (
              <p id={`${titleId}-name-error`} className="text-xs text-danger">
                {errors.name}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="contact-email"
              className="text-xs font-semibold text-fg"
            >
              E-mail
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email)
                  setErrors((current) => ({ ...current, email: undefined }));
              }}
              className="h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2"
              placeholder="naam@email.nl"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={
                errors.email ? `${titleId}-email-error` : undefined
              }
            />
            {errors.email && (
              <p id={`${titleId}-email-error`} className="text-xs text-danger">
                {errors.email}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="contact-message"
              className="text-xs font-semibold text-fg"
            >
              Bericht
            </label>
            <textarea
              id="contact-message"
              name="message"
              rows={4}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (errors.message)
                  setErrors((current) => ({ ...current, message: undefined }));
              }}
              className="w-full resize-y rounded-xl border border-border bg-bg px-3.5 py-3 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2 min-h-[6.5rem]"
              placeholder="Waar kunnen we je mee helpen?"
              aria-invalid={Boolean(errors.message)}
              aria-describedby={
                errors.message ? `${titleId}-message-error` : undefined
              }
            />
            {errors.message && (
              <p
                id={`${titleId}-message-error`}
                className="text-xs text-danger"
              >
                {errors.message}
              </p>
            )}
          </div>

          <p className="text-[11px] text-dim leading-relaxed">
            Of mail direct:{" "}
            <a
              href="mailto:support@voltperformance.nl"
              className="font-medium text-primary hover:underline"
            >
              support@voltperformance.nl
            </a>
          </p>

          <div className="mt-auto flex flex-col gap-2 pt-1 sm:flex-row-reverse">
            <Button
              type="submit"
              className="w-full sm:flex-1"
              disabled={sending}
              aria-busy={sending}
            >
              {sending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Versturen…
                </>
              ) : (
                "Verstuur bericht"
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={close}
              disabled={sending}
            >
              Annuleren
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
