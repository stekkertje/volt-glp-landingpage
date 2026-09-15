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

export const Route = createFileRoute("/wachtwoord-herstellen")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : "",
  }),
  beforeLoad: () => {
    if (!authEnabled) throw redirect({ to: "/account", replace: true });
  },
  component: ResetPasswordPage,
  head: () => ({
    meta: [
      { title: "Nieuw wachtwoord | Afslank-injecties.nl" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get("password") ?? "");
    if (password !== String(fields.get("passwordConfirmation") ?? "")) {
      setError("De wachtwoorden zijn niet gelijk.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await authClient.resetPassword({
        token,
        newPassword: password,
      });
      if (result.error) {
        setError("Deze herstellink is ongeldig, verlopen of al gebruikt.");
        return;
      }
      window.history.replaceState(null, "", "/wachtwoord-herstellen");
      setSuccess(true);
    } catch {
      setError("Het wachtwoord kon niet worden bijgewerkt.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Nieuw wachtwoord"
      description="Kies een nieuw wachtwoord voor je account."
    >
      {success ? (
        <>
          <AuthMessage tone="success">Je wachtwoord is bijgewerkt.</AuthMessage>
          <Button asChild className="w-full">
            <Link to="/login" search={{ redirect: "/account", reset: true }}>
              Naar inloggen
            </Link>
          </Button>
        </>
      ) : !token ? (
        <>
          <AuthMessage tone="error">
            Deze herstellink is ongeldig of onvolledig.
          </AuthMessage>
          <Button asChild variant="secondary" className="w-full">
            <Link to="/wachtwoord-vergeten">Nieuwe link aanvragen</Link>
          </Button>
        </>
      ) : (
        <>
          {error && <AuthMessage tone="error">{error}</AuthMessage>}
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Nieuw wachtwoord</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                className={authInputClass}
              />
              <span className="block text-xs text-dim">
                Minimaal 12 tekens.
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Herhaal wachtwoord</span>
              <input
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                className={authInputClass}
              />
            </label>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {submitting ? "Opslaan…" : "Wachtwoord opslaan"}
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  );
}
