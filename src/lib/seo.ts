const host = import.meta.env.VITE_PUBLIC_HOSTNAME;

export const PUBLIC_ORIGIN = host
  ? `https://${host}`
  : "https://afslank-injecties.nl";

export const HOME_SEO_TITLE = "GLP-1 medicatie kopen | Afvallen met injecties";
export const HOME_SEO_DESCRIPTION =
  "Semaglutide, Tirzepatide of Retatrutide kopen. Afvallen met medicatie. Kant-en-klare pen. Discrete verzending NL en BE, met track en trace.";

export function canonicalLink(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return { rel: "canonical" as const, href: `${PUBLIC_ORIGIN}${normalized}` };
}

export function pageHead({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
    links: [canonicalLink(path)],
  };
}
