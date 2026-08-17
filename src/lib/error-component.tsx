import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main
      className={
        "flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center " +
        "bg-bg text-fg"
      }
    >
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">Er ging iets mis</h1>
      <p className="max-w-md text-sm break-words text-muted">
        {error.message || "Er is een onverwachte fout opgetreden. Probeer de pagina te vernieuwen."}
      </p>
    </main>
  );
}
