import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import { SITE } from "@/lib/product";
import { pageHead } from "@/lib/seo";
import { formatEuro } from "@/lib/utils";

export const Route = createFileRoute("/verzending")({
  component: ShippingPage,
  head: () =>
    pageHead({
      title: "Verzending naar Nederland en België | Afslank-injecties.nl",
      description:
        "Afslank-injecties.nl verstuurt via PostNL naar Nederland en België. €4,95 verzendkosten, gratis vanaf €100. Levering 1–2 werkdagen na ontvangst betaling",
      path: "/verzending",
    }),
});

function ShippingPage() {
  return (
    <LegalPage
      title="Verzending & levering"
      breadcrumb="Verzending"
      path="/verzending"
    >
      <ul>
        <li>Nederland en België</li>
        <li>Verzending via PostNL</li>
        <li>Levertijd 1–2 werkdagen na ontvangst van de betaling</li>
        <li>
          Gratis verzending vanaf {formatEuro(SITE.freeShippingCents)}, anders
          €4,95
        </li>
        <li>Discreet verzonden, met track &amp; trace</li>
      </ul>
      <h2>Retourneren</h2>
      <p>Vanwege de aard van de producten is retourneren in de regel niet mogelijk.</p>
      <p>
        <Link to="/betaling">Betaling</Link>
        {" · "}
        <Link to="/voorwaarden">Voorwaarden</Link>
      </p>
    </LegalPage>
  );
}
