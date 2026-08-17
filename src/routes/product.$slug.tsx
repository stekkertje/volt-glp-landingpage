import { createFileRoute, Link } from "@tanstack/react-router";
import { getProduct, SITE } from "@/lib/product";
import { ProductPage } from "@/components/product-page";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/product/$slug")({
  component: ProductRoute,
  head: ({ params }) => {
    const product = getProduct(params.slug);
    const title = product
      ? `${product.name} kopen | ${SITE.brand}`
      : `Product | ${SITE.brand}`;
    const description = product
      ? `${product.shortPitch} Labgetest. Discrete verzending NL en BE.`
      : SITE.shortPitch;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
});

function ProductRoute() {
  const { slug } = Route.useParams();
  const product = getProduct(slug);

  if (!product) {
    return (
      <SiteShell>
        <div className="container-max section-pad py-24 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">Product niet gevonden</h1>
          <p className="mt-2 text-sm text-muted">Dit product zit niet in de GLP-1 catalogus.</p>
          <Button className="mt-6" asChild>
            <Link to="/">Terug naar producten</Link>
          </Button>
        </div>
      </SiteShell>
    );
  }

  return <ProductPage product={product} />;
}
