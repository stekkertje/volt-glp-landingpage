import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { SITE } from "@/lib/product";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect:
      search.redirect === "/admin" || search.redirect === "/account"
        ? search.redirect
        : "/account",
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
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 py-12 text-fg">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-fg text-sm font-extrabold">
              A
            </span>
            <span className="text-xl font-extrabold tracking-tight">
              {SITE.brand}
            </span>
          </Link>
          <h1 className="mt-6 text-2xl font-extrabold tracking-tight">
            Inloggen
          </h1>
          <p className="mt-2 text-sm text-muted">
            Log in om je bestellingen en account te beheren.
          </p>
        </div>

        <div className="space-y-3">
          {GROK_PROVIDERS.map((p) => (
            <button
              key={p.providerId}
              type="button"
              onClick={() => signIn(p.providerId, { callbackURL: redirect })}
              className="flex h-12 w-full items-center justify-center rounded-md border border-border-strong bg-surface text-sm font-semibold text-fg transition-colors hover:border-primary/40 hover:bg-bg-elevated"
            >
              Doorgaan met {p.label}
            </button>
          ))}
        </div>

        <p className="text-center text-sm text-dim">
          <Link to="/" className="font-medium text-primary hover:underline">
            Terug naar de winkel
          </Link>
        </p>
      </div>
    </main>
  );
}
