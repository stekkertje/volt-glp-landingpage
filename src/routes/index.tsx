import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/components/landing-page";

const host = import.meta.env.VITE_PUBLIC_HOSTNAME;

export const Route = createFileRoute("/")({
  component: HomePage,
  head: () => ({
    links: host ? [{ rel: "canonical", href: `https://${host}/` }] : [],
  }),
});

function HomePage() {
  return <LandingPage />;
}
