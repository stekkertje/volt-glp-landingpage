import { createFileRoute } from "@tanstack/react-router";
import { LegalPage } from "@/components/legal-page";
import { SITE } from "@/lib/product";

export const Route = createFileRoute("/cookies")({
  component: CookiesPage,
  head: () => ({
    meta: [
      { title: `Cookiebeleid | ${SITE.brand}` },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
  }),
});

function CookiesPage() {
  return (
    <LegalPage title="Cookiebeleid">
      <p>
        Deze webshop gebruikt uitsluitend noodzakelijke browseropslag om je
        winkelwagen op dit apparaat te bewaren. Er worden geen advertentie- of
        trackingcookies geplaatst.
      </p>
      <p>
        Je kunt de opgeslagen winkelwagen verwijderen door je browsergegevens
        voor deze website te wissen.
      </p>
    </LegalPage>
  );
}
