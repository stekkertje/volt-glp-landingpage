import { createFileRoute, Link } from "@tanstack/react-router";
import { BankTransferDetails } from "@/components/bank-transfer-details";
import { LegalPage } from "@/components/legal-page";
import { SITE } from "@/lib/product";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/betaling")({
  component: PaymentPage,
  head: () =>
    pageHead({
      title:
        "Semaglutide, Tirzepatide, Retatrutide betalen | Afslank-injecties.nl",
      description:
        "Eenvoudig, snel en veilig betalen voor Semaglutide, Tirzepatide en Retatrutide | Afslank-injecties.nl",
      path: "/betaling",
    }),
});

function PaymentPage() {
  return (
    <LegalPage title="Betaling" breadcrumb="Betaling" path="/betaling">
      <p>
        Bij {SITE.brand} betaal je via <strong>bankoverschrijving</strong>. Na je
        bestelling zie je de bankgegevens op het scherm en in je
        bevestigingsmail.
      </p>
      <h2>Zo werkt het</h2>
      <ul>
        <li>Je plaatst de bestelling en krijgt een bestelnummer.</li>
        <li>Je maakt het bedrag over met het bestelnummer als omschrijving.</li>
        <li>Banktransacties duren meestal 24–48 uur. Daarna bevestigen we per e-mail.</li>
        <li>We verzenden het pakket discreet, met track &amp; trace.</li>
      </ul>
      <h2>Rekening</h2>
      <BankTransferDetails />
      <p>
        <Link to="/verzending">Verzending</Link>
        {" · "}
        <Link to="/voorwaarden">Voorwaarden</Link>
      </p>
    </LegalPage>
  );
}
