import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth/server";
import { enforceAuthPostLimit } from "@/lib/server/abuse-protection.server";
import { RateLimitError, applyRateLimitResponse } from "@/lib/server/rate-limit.server";
import { getRequestClientIdentifier } from "@/lib/server/request-client.server";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: async ({ request }) => {
        try {
          await enforceAuthPostLimit(getRequestClientIdentifier());
        } catch (error) {
          applyRateLimitResponse(error);
          if (error instanceof RateLimitError) {
            return new Response(JSON.stringify({ message: error.message }), {
              status: 429,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          }
          throw error;
        }
        return auth.handler(request);
      },
    },
  },
});
