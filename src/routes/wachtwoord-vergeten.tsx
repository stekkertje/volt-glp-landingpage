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

export const Route = createFileRoute("/wachtwoord-vergeten")({
  beforeLoad: () => {
    if (!authEnabled) throw redirect({ to: "/account", replace: true });
  },
  component: ForgotPasswordPage,
  head: () => ({
    meta: [
      { title: "Wachtwoord vergeten | Afslank-injecties.nl" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSubmitting(true);
    setSuccess(false);
    setError("");
    try {
      const result = await authClient.requestPasswordReset({
        email: String(fields.get("email") ?? "")
          .trim()
          .toLowerCase(),
        redirectTo: "/wachtwoord-herstellen",
      });
      if (result.error) {
        setError(
          "De herstellink kon niet worden aangevraagd. Probeer het later opnieuw.",
        );
        return;
      }
      // Bekend en onbekend adres krijgen bewust exact dezelfde successtatus.
      setSuccess(true);
    } catch {
      setError(
        "De herstellink kon niet worden aangevraagd. Probeer het later opnieuw.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Wachtwoord vergeten"
      description="Vraag veilig een link aan om een nieuw wachtwoord in te stellen."
    >
      {success ? (
        <>
          <AuthMessage tone="success">
            Als dit e-mailadres bij ons bekend is, ontvang je een herstellink.
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
              {submitting ? "Versturen…" : "Herstellink aanvragen"}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
