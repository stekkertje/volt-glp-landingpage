import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  AuthMessage,
  AuthShell,
  authInputClass,
} from "@/components/account/auth-shell";
import { Button } from "@/components/ui/button";
import { authClient, authEnabled } from "@/lib/auth/client";

export const Route = createFileRoute("/bevestigingsmail-opnieuw")({
  beforeLoad: () => {
    if (!authEnabled) throw redirect({ to: "/account", replace: true });
  },
  component: ResendVerificationPage,
  head: () => ({
    meta: [
      { title: "Bevestigingsmail opnieuw sturen | Afslank-injecties.nl" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function ResendVerificationPage() {
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSubmitting(true);
    setComplete(false);
    setError("");
    try {
      const result = await authClient.sendVerificationEmail({
        email: String(fields.get("email") ?? "")
          .trim()
          .toLowerCase(),
        callbackURL: "/login?verified=1",
      });
      if (result.error) {
        setError(
          "De bevestigingsmail kon niet worden aangevraagd. Probeer het later opnieuw.",
        );
        return;
      }
      // Bekend en onbekend adres krijgen bewust exact dezelfde successtatus.
      setComplete(true);
    } catch {
      setError(
        "De bevestigingsmail kon niet worden aangevraagd. Probeer het later opnieuw.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Bevestigingsmail opnieuw sturen"
      description="Vraag een nieuwe link aan als de vorige link is verlopen of niet is aangekomen."
    >
      {complete ? (
        <>
          <AuthMessage tone="success">
            Als dit e-mailadres bij een onbevestigd account hoort, ontvang je
            een nieuwe bevestigingsmail.
          </AuthMessage>
          <Button asChild variant="secondary" className="w-full">
            <Link to="/login" search={{ redirect: "/account" }}>
              Terug naar inloggen
            </Link>
          </Button>
        </>
      ) : (
        <>
          {error && <AuthMessage tone="error">{error}</AuthMessage>}
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">E-mailadres</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className={authInputClass}
              />
            </label>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {submitting ? "Versturen…" : "Nieuwe bevestigingsmail aanvragen"}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
