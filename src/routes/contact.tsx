import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/contact")({
  loader: () => {
    throw redirect({
      href: "/?contact=1",
    });
  },
});
