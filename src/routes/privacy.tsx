import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import { SITE } from "@/lib/product";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () =>
    pageHead({
      title: "Privacybeleid | Afslank-injecties.nl",
      description:
        "Lees alles over hoe afslank-injecties.nl omgaat met de privacy van jouw gegevens",
      path: "/privacy",
    }),
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacybeleid" breadcrumb="Privacybeleid" path="/privacy">
      <p>
        {SITE.brand} verwerkt alleen persoonsgegevens die nodig zijn voor het
        aannemen, betalen en bezorgen van bestellingen en voor klantenservice.
      </p>
      <h2>Welke gegevens verwerken we?</h2>
      <ul>
        <li>Naam, afleveradres en contactgegevens.</li>
        <li>Bestelregels, bestelbedrag en betaalstatus.</li>
        <li>Vragen over je bestelling.</li>
      </ul>
      <h2>Delen met derden</h2>
      <p>
        Je gegevens worden niet verkocht. Adresgegevens gaan naar{" "}
        <strong>PostNL</strong> om je pakket te bezorgen.
      </p>
      <h2>Bewaartermijn</h2>
      <p>We bewaren gegevens niet langer dan nodig is om je als klant te helpen.</p>
      <p>
        Contact:{" "}
        <a href="mailto:info@afslank-injecties.nl">info@afslank-injecties.nl</a>
      </p>
      <p>
        <Link to="/voorwaarden">Voorwaarden</Link>
        {" · "}
        <Link to="/verzending">Verzending</Link>
      </p>
    </LegalPage>
  );
}
