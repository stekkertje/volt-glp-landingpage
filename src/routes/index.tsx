import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing-page";
import {
  HOME_SEO_DESCRIPTION,
  HOME_SEO_TITLE,
  pageHead,
} from "@/lib/seo";

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () =>
    pageHead({
      title: HOME_SEO_TITLE,
      description: HOME_SEO_DESCRIPTION,
      path: "/",
    }),
});

function HomePage() {
  return <LandingPage />;
}
