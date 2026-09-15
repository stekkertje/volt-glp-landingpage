import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  AuthMessage,
  AuthShell,
  authInputClass,
} from "@/components/account/auth-shell";
import { Button } from "@/components/ui/button";
import {
  authClient,
  authEnabled,
  GROK_PROVIDERS,
  oauthEnabled,
  oauthEnabledForCurrentBrowser,
  signIn,
} from "@/lib/auth/client";

export const Route = createFileRoute("/login")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    redirect: "/admin" | "/account";
    verified?: boolean;
    reset?: boolean;
    verificationError?: boolean;
  } => ({
    redirect: search.redirect === "/admin" ? "/admin" : "/account",
    verified:
      !search.error &&
      (search.verified === "1" ||
        search.verified === 1 ||
        search.verified === true)
        ? true
        : undefined,
    reset:
      search.reset === "1" || search.reset === 1 || search.reset === true
        ? true
        : undefined,
    verificationError:
      typeof search.error === "string" && search.error.length > 0
        ? true
        : undefined,
  }),
  beforeLoad: ({ search }) => {
    if (!authEnabled) {
      throw redirect({
        to: search.redirect === "/admin" ? "/admin" : "/account",
        replace: true,
      });
    }
  },
  component: LoginPage,
  head: () => ({
    meta: [
      { title: "Inloggen | Afslank-injecties.nl" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function LoginPage() {
  const {
    redirect: redirectTo,
    verified,
    reset,
    verificationError,
  } = Route.useSearch();
  const [submitting, setSubmitting] = useState(false);
  const [providerSubmitting, setProviderSubmitting] = useState<string | null>(
    null,
  );
  const [showOAuth, setShowOAuth] = useState(oauthEnabled);
  const [error, setError] = useState("");

  useEffect(() => {
    setShowOAuth(oauthEnabledForCurrentBrowser());
  }, []);

  const onProviderSignIn = async (providerId: string, label: string) => {
    setProviderSubmitting(providerId);
    setError("");
    try {
      await signIn(providerId, {
        callbackURL: redirectTo,
        errorCallbackURL: `/login?redirect=${encodeURIComponent(redirectTo)}`,
      });
    } catch {
      setError(
        `Inloggen via ${label} lukt nu niet. Probeer het later opnieuw.`,
      );
    } finally {
      setProviderSubmitting(null);
    }
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    try {
      const result = await authClient.signIn.email({
        email: String(fields.get("email") ?? "")
          .trim()
          .toLowerCase(),
        password: String(fields.get("password") ?? ""),
        callbackURL: redirectTo,
      });
      if (result.error) {
        setError(
          result.error.code === "EMAIL_NOT_VERIFIED"
            ? "Bevestig eerst je e-mailadres via de link in je inbox."
            : "E-mailadres of wachtwoord is onjuist.",
        );
        return;
      }
      // Better Auth verwerkt de veilige callbackURL en navigeert na succes.
    } catch {
      setError("Inloggen lukt nu niet. Probeer het later opnieuw.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Inloggen"
      description="Bekijk je bestellingen, adressen en verzendstatus."
    >
      {verified && (
        <AuthMessage tone="success">
          Je e-mailadres is bevestigd. Je kunt nu inloggen.
        </AuthMessage>
      )}
      {reset && (
        <AuthMessage tone="success">
          Je wachtwoord is bijgewerkt. Je kunt nu inloggen.
        </AuthMessage>
      )}
      {verificationError && (
        <AuthMessage tone="error">
          Deze bevestigingslink is ongeldig of verlopen. Vraag een nieuwe link
          aan.
        </AuthMessage>
      )}
      {error && <AuthMessage tone="error">{error}</AuthMessage>}

      {showOAuth && GROK_PROVIDERS.length > 0 && (
        <>
          <div className="space-y-2">
            {GROK_PROVIDERS.map((provider) => (
              <Button
                key={provider.providerId}
                type="button"
                variant="secondary"
                className="w-full"
                disabled={submitting || providerSubmitting !== null}
                onClick={() =>
                  void onProviderSignIn(provider.providerId, provider.label)
                }
              >
                {providerSubmitting === provider.providerId && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                {providerSubmitting === provider.providerId
                  ? `Verbinden met ${provider.label}…`
                  : `Doorgaan met ${provider.label}`}
              </Button>
            ))}
          </div>
          <div className="my-5 flex items-center gap-3 text-xs font-semibold text-dim">
            <span className="h-px flex-1 bg-border" aria-hidden />
            <span>of met e-mailadres</span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
        </>
      )}

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
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold">Wachtwoord</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={authInputClass}
          />
        </label>
        <div className="flex justify-end">
          <Link
            to="/wachtwoord-vergeten"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Wachtwoord vergeten?
          </Link>
        </div>
        <Button
          type="submit"
          className="w-full"
          disabled={submitting || providerSubmitting !== null}
        >
          {submitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          )}
          {submitting ? "Inloggen…" : "Inloggen"}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        Nog geen account?{" "}
        <Link
          to="/registreren"
          className="font-semibold text-primary hover:underline"
        >
          Account aanmaken
        </Link>
      </p>
      <p className="mt-3 text-center text-sm text-muted">
        <Link
          to="/bevestigingsmail-opnieuw"
          className="font-semibold text-primary hover:underline"
        >
          Bevestigingsmail niet ontvangen?
        </Link>
      </p>
    </AuthShell>
  );
}
