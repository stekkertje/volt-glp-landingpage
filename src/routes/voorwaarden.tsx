import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import { SITE } from "@/lib/product";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/voorwaarden")({
  component: TermsPage,
  head: () =>
    pageHead({
      title: "Algemene voorwaarden | Afslank-injecties.nl",
      description:
        "Voorwaarden van Afslank-injecties.nl: lees hier alles over het bestellen, betalen en verzenden.",
      path: "/voorwaarden",
    }),
});

function TermsPage() {
  return (
    <LegalPage
      title="Algemene voorwaarden"
      breadcrumb="Algemene voorwaarden"
      path="/voorwaarden"
    >
      <p>Door een bestelling te plaatsen ga je akkoord met deze voorwaarden.</p>
      <h2>Overeenkomst</h2>
      <p>
        De koopovereenkomst komt tot stand wanneer {SITE.brand} je bestelling
        heeft bevestigd.
      </p>
      <h2>Betaling</h2>
      <p>
        Betaling verloopt via bankoverschrijving. Je bestelling wordt pas
        verwerkt en verzonden nadat de betaling is ontvangen.
      </p>
      <h2>Levering</h2>
      <p>
        We leveren in Nederland en België. Zie{" "}
        <Link to="/verzending">Verzending</Link>. Pakketten worden discreet
        verzonden.
      </p>
      <h2>Retourneren</h2>
      <p>Vanwege de aard van de producten is retourneren in de regel niet mogelijk.</p>
      <h2>Aansprakelijkheid</h2>
      <p>
        Het gebruik van onze producten is op eigen risico. {SITE.brand} is niet
        aansprakelijk voor eventuele bijwerkingen of gevolgen van gebruik.
      </p>
      <h2>Contact</h2>
      <p>
        <a href="mailto:info@afslank-injecties.nl">info@afslank-injecties.nl</a>
      </p>
    </LegalPage>
  );
}
