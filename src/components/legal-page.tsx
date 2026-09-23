import type { ReactNode } from "react";
import { SiteShell } from "@/components/site-shell";

export function LegalPage({
  title,
  children,
  breadcrumb,
  path,
}: {
  title: string;
  children: ReactNode;
  breadcrumb?: string;
  path?: string;
}) {
  const origin = import.meta.env.VITE_PUBLIC_HOSTNAME
    ? `https://${import.meta.env.VITE_PUBLIC_HOSTNAME}`
    : "https://afslank-injecties.nl";
  const url = path ? `${origin}${path}` : undefined;
  const crumb = breadcrumb ?? title;
  const jsonLd = path
    ? {
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "Home",
                item: `${origin}/`,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: crumb,
                item: url,
              },
            ],
          },
          { "@type": "WebPage", name: title, url },
        ],
      }
    : null;

  return (
    <SiteShell>
      <article className="container-max section-pad max-w-2xl py-10 md:py-14">
        {path ? (
          <nav className="mb-6 text-xs text-muted" aria-label="Broodkruimel">
            <a href="/#top" className="hover:text-fg">
              Home
            </a>
            <span className="mx-1.5">/</span>
            <span className="text-fg">{crumb}</span>
          </nav>
        ) : null}
        <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">
          {title}
        </h1>
        <div className="mt-6 space-y-4 text-sm leading-relaxed text-muted [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-fg [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          {children}
        </div>
      </article>
      {jsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      ) : null}
    </SiteShell>
  );
}
