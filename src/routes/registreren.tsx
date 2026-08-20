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

const REGISTRATION_ERROR =
  "Account aanmaken lukt nu niet. Probeer het later opnieuw.";

function isDuplicateAccountError(error: { code?: string }): boolean {
  return (
    error.code === "USER_ALREADY_EXISTS" ||
    error.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"
  );
}

export const Route = createFileRoute("/registreren")({
  beforeLoad: () => {
    if (!authEnabled) throw redirect({ to: "/account", replace: true });
  },
  component: RegisterPage,
  head: () => ({
    meta: [
      { title: "Account aanmaken | Afslank-injecties.nl" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function RegisterPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password") ?? "");
    const confirmation = String(fields.get("passwordConfirmation") ?? "");
    if (password !== confirmation) {
      setError("De wachtwoorden zijn niet gelijk.");
      return;
    }
    setSubmitting(true);
    setSuccess(false);
    setError("");
    try {
      const result = await authClient.signUp.email({
        name: String(fields.get("name") ?? "").trim(),
        email: String(fields.get("email") ?? "")
          .trim()
          .toLowerCase(),
        password,
        callbackURL: "/login?verified=1",
      });
      if (result.error && !isDuplicateAccountError(result.error)) {
        setError(REGISTRATION_ERROR);
        return;
      }
      // Een bestaand adres krijgt bewust dezelfde zichtbare status als nieuw.
      form.reset();
      setSuccess(true);
    } catch {
      setError(REGISTRATION_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Account aanmaken"
      description="Ontvang toegang tot je eigen bestelgeschiedenis en tracking."
    >
      {success ? (
        <>
          <AuthMessage tone="success">
            Als dit e-mailadres nog niet bij ons bekend is, ontvang je een
            bevestigingsmail. Heb je al een account, dan kun je inloggen of een
            nieuw wachtwoord aanvragen.
          </AuthMessage>
          <Button asChild className="w-full">
            <Link to="/login" search={{ redirect: "/account" }}>
              Naar inloggen
            </Link>
          </Button>
          <Button asChild variant="secondary" className="mt-2 w-full">
            <Link to="/bevestigingsmail-opnieuw">
              Bevestigingsmail opnieuw sturen
            </Link>
          </Button>
        </>
      ) : (
        <>
          {error && <AuthMessage tone="error">{error}</AuthMessage>}
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Naam</span>
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={120}
                className={authInputClass}
              />
            </label>
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
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold">Wachtwoord</span>
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
              {submitting ? "Account aanmaken…" : "Account aanmaken"}
            </Button>
          </form>
          <p className="mt-5 text-center text-sm text-muted">
            Al een account?{" "}
            <Link
              to="/login"
              search={{ redirect: "/account" }}
              className="font-semibold text-primary hover:underline"
            >
              Inloggen
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
