import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { getProduct, SITE } from "@/lib/product";
import { ProductPage } from "@/components/product-page";
import { SiteShell } from "@/components/site-shell";
import { Button } from "@/components/ui/button";

const host = import.meta.env.VITE_PUBLIC_HOSTNAME;

export const Route = createFileRoute("/product/$slug")({
  component: ProductRoute,
  loader: ({ params }) => {
    const product = getProduct(params.slug);
    if (!product) throw notFound();
    return product;
  },
  notFoundComponent: ProductNotFound,
  head: ({ params }) => {
    const product = getProduct(params.slug);
    const title = product
      ? `${product.name} kopen | ${SITE.brand}`
      : `Product | ${SITE.brand}`;
    const description = product
      ? `${product.shortPitch} Labgetest. Discrete verzending NL en BE.`
      : SITE.shortPitch;
    const canonical =
      host && product ? `https://${host}/product/${product.slug}` : undefined;
    const productImage =
      host && product?.images[0]
        ? `https://${host}${product.images[0].src}`
        : undefined;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "product" },
        ...(canonical ? [{ property: "og:url", content: canonical }] : []),
        ...(productImage
          ? [
              { property: "og:image", content: productImage },
              { property: "og:image:width", content: "800" },
              { property: "og:image:height", content: "800" },
              { name: "twitter:card", content: "summary_large_image" },
            ]
          : []),
      ],
      links: canonical ? [{ rel: "canonical", href: canonical }] : [],
    };
  },
});

function ProductRoute() {
  const product = Route.useLoaderData();
  return <ProductPage product={product} />;
}

function ProductNotFound() {
  return (
    <SiteShell>
      <div className="container-max section-pad py-24 text-center">
        <h1 className="text-2xl font-extrabold tracking-tight">
          Product niet gevonden
        </h1>
        <p className="mt-2 text-sm text-muted">
          Dit product zit niet in de GLP-1 catalogus.
        </p>
        <Button className="mt-6" asChild>
          <Link to="/">Terug naar producten</Link>
        </Button>
      </div>
    </SiteShell>
  );
}
