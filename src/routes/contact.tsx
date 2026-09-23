import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/contact")({
  loader: () => {
    throw redirect({
      to: "/",
      search: { contact: "1" },
    });
  },
});
