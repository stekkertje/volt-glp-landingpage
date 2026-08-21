import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SITE } from "@/lib/product";

export const authInputClass =
  "h-11 w-full rounded-xl border border-border bg-bg px-3.5 text-sm text-fg outline-none ring-primary/30 placeholder:text-dim focus:border-primary focus:ring-2";

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 py-12 text-fg">
      <div className="w-full max-w-md">
        <div className="text-center">
          <Link to="/" className="inline-flex items-center gap-2">
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-sm font-extrabold text-primary-fg">
              A
            </span>
            <span className="text-xl font-extrabold tracking-tight">
              {SITE.brand}
            </span>
          </Link>
          <h1 className="mt-6 text-2xl font-extrabold tracking-tight">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted">{description}</p>
        </div>
        <section className="mt-7 rounded-xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          {children}
        </section>
        <p className="mt-5 text-center text-sm text-dim">
          <Link to="/" className="font-medium text-primary hover:underline">
            Terug naar de winkel
          </Link>
        </p>
      </div>
    </main>
  );
}

export function AuthMessage({
  tone,
  children,
}: {
  tone: "success" | "error";
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "mb-4 rounded-lg border border-danger/25 bg-danger/5 p-3 text-sm text-danger"
          : "mb-4 rounded-lg border border-success/25 bg-success/5 p-3 text-sm text-success"
      }
    >
      {children}
    </p>
  );
}
