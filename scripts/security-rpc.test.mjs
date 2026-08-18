import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

const TEST_ADMIN_PASSWORD = `admin-${randomUUID()}`;
const TEST_ADMIN_SESSION_SECRET = `${randomUUID()}-${randomUUID()}`;
let baseUrl;
let browser;
let devServer;
let serverOutput = "";
let viteCacheDir;
const TEST_DATABASE_SOURCE_MARKER =
  "[app-builder] verified database source: pglite";

async function availablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("No test port available");
  }
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (devServer.exitCode !== null) {
      throw new Error(`Vite stopped before startup:\n${serverOutput}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok && serverOutput.includes(TEST_DATABASE_SOURCE_MARKER)) {
        return;
      }
    } catch {
      // The process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready:\n${serverOutput}`);
}

async function signalProcessGroupAndWait(child, signal, timeout) {
  return new Promise((resolve) => {
    let timer;
    const finish = (exited) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    timer = setTimeout(() => finish(false), timeout);
    try {
      process.kill(-child.pid, signal);
    } catch {
      finish(true);
    }
  });
}

async function stopDevServer() {
  if (
    !devServer?.pid ||
    devServer.exitCode !== null ||
    devServer.signalCode !== null
  ) {
    return;
  }
  const exited = await signalProcessGroupAndWait(devServer, "SIGTERM", 5_000);
  if (!exited && devServer.exitCode === null) {
    await signalProcessGroupAndWait(devServer, "SIGKILL", 2_000);
  }
}

async function withPage(run) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    return await run(page);
  } finally {
    await context.close();
  }
}

before(async () => {
  const port = await availablePort();
  baseUrl = `http://127.0.0.1:${port}`;
  viteCacheDir = await mkdtemp(join(tmpdir(), "volt-security-rpc-vite-"));
  devServer = spawn(
    "npm",
    ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: "",
        MIGRATION_DATABASE_URL: "",
        DATABASE_URL_UNPOOLED: "",
        VERCEL: "",
        NETLIFY: "",
        REQUIRE_DATABASE: "",
        PGLITE_PREVIEW: "",
        NODE_ENV: "test",
        npm_lifecycle_event: "test",
        VOLT_TEST_EXPECT_DB_SOURCE: "pglite",
        VOLT_TEST_VITE_CACHE_DIR: viteCacheDir,
        ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        ADMIN_SESSION_SECRET: TEST_ADMIN_SESSION_SECRET,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  for (const stream of [devServer.stdout, devServer.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
    });
  }
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
});

after(async () => {
  try {
    await browser?.close();
  } finally {
    await stopDevServer();
    if (viteCacheDir) {
      await rm(viteCacheDir, { recursive: true, force: true });
    }
  }
});

test("checkout conflict keeps a stable discriminant and HTTP 409 across RPC", async () => {
  const outcome = await withPage((page) =>
    page.evaluate(
      async ({ unique }) => {
        const { createOrder } = await import("/src/lib/server/orders.ts");
        const { isConflictServerError } =
          await import("/src/lib/server-error.ts");
        const input = {
          name: "RPC review",
          email: `rpc-${unique}@example.test`,
          street: "Teststraat",
          houseNumber: "12",
          postcode: "1234 AB",
          city: "Utrecht",
          country: "NL",
          lines: [{ slug: "semaglutide-4mg-pen", optionId: "default", qty: 1 }],
          idempotencyKey: `rpc-conflict-${unique}`,
        };

        const invoke = async (data) => {
          let body = "";
          let status = 0;
          try {
            await createOrder({
              data,
              fetch: async (url, init) => {
                const response = await fetch(url, init);
                status = response.status;
                body = await response.clone().text();
                return response;
              },
            });
            return { body, status, ok: true };
          } catch (error) {
            return {
              body,
              status,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
              recognized: isConflictServerError(error),
            };
          }
        };

        const first = await invoke(input);
        const conflict = await invoke({ ...input, street: "Andere straat" });
        return { first, conflict };
      },
      { unique: randomUUID() },
    ),
  );

  assert.equal(outcome.first.ok, true);
  assert.equal(outcome.first.status, 200);
  assert.equal(outcome.conflict.ok, false);
  assert.equal(outcome.conflict.status, 409);
  assert.equal(outcome.conflict.message, "Deze bestelling is al geplaatst.");
  assert.equal(outcome.conflict.recognized, true);
  assert.doesNotMatch(
    outcome.conflict.body,
    /Deze herhaalcode hoort bij een andere bestelling/,
  );
});

test("origin guards return HTTP 403 at the real server-function endpoint", async () => {
  const captured = await withPage((page) =>
    page.evaluate(
      async ({ unique }) => {
        const { createContactMessage } =
          await import("/src/lib/server/contact.ts");
        let request;
        await createContactMessage({
          data: {
            name: "RPC origin review",
            email: `origin-${unique}@example.test`,
            message: "Dit is een geldig testbericht voor de RPC-grens.",
          },
          fetch: async (url, init) => {
            request = {
              url: String(url),
              method: init.method,
              headers: [...new Headers(init.headers).entries()],
              body: typeof init.body === "string" ? init.body : "",
            };
            return fetch(url, init);
          },
        });
        return request;
      },
      { unique: randomUUID() },
    ),
  );

  assert.ok(captured);
  const requestUrl = new URL(captured.url, baseUrl);
  const originalHeaders = new Headers(captured.headers);
  const request = async (headers) =>
    fetch(requestUrl, {
      method: captured.method,
      headers,
      body: captured.body,
    });

  const crossSiteHeaders = new Headers(originalHeaders);
  crossSiteHeaders.set("origin", "https://evil.example.test");
  crossSiteHeaders.set("sec-fetch-site", "cross-site");
  const crossSite = await request(crossSiteHeaders);
  assert.equal(crossSite.status, 403);
  assert.equal(await crossSite.text(), "Forbidden");

  const conflictingOriginHeaders = new Headers(originalHeaders);
  conflictingOriginHeaders.set("origin", "https://evil.example.test");
  // TanStack's outer CSRF layer trusts this Fetch-Metadata value. Our stricter
  // mutation guard must still reject the contradictory Origin header.
  conflictingOriginHeaders.set("sec-fetch-site", "same-origin");
  const conflictingOrigin = await request(conflictingOriginHeaders);
  assert.equal(conflictingOrigin.status, 403);
  assert.match(await conflictingOrigin.text(), /Ongeldige aanvraag/);
});

test("public server errors hide validation and unexpected internal details", async () => {
  const outcome = await withPage((page) =>
    page.evaluate(async () => {
      const { createContactMessage } =
        await import("/src/lib/server/contact.ts");
      const { ORDER_SERVER_ERROR_POLICY } =
        await import("/src/lib/server/orders.ts");
      const { resolvePublicServerError } =
        await import("/src/lib/server-error.ts");
      let body = "";
      let status = 0;
      let message = "";
      try {
        await createContactMessage({
          data: {
            name: "",
            email: "not-an-email",
            message: "kort",
          },
          fetch: async (url, init) => {
            const response = await fetch(url, init);
            status = response.status;
            body = await response.clone().text();
            return response;
          },
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      const secret = "password=super-secret database=postgres.internal";
      const unexpected = resolvePublicServerError(new Error(secret), {
        fallbackMessage: "Veilige algemene foutmelding.",
      });
      const replayExpired = new Error(
        "De tijdelijke toegang tot deze bestelling is verlopen.",
      );
      replayExpired.name = "IdempotencyReplayExpiredError";
      replayExpired.status = 410;
      const replayUnavailable = new Error(
        "De bestaande bestelling kan niet veilig opnieuw worden geopend. Neem contact op met de beheerder.",
      );
      replayUnavailable.name = "IdempotencyReplayUnavailableError";
      replayUnavailable.status = 503;
      return {
        body,
        message,
        status,
        secret,
        unexpected,
        replayExpired: resolvePublicServerError(
          replayExpired,
          ORDER_SERVER_ERROR_POLICY,
        ),
        replayUnavailable: resolvePublicServerError(
          replayUnavailable,
          ORDER_SERVER_ERROR_POLICY,
        ),
      };
    }),
  );

  assert.equal(outcome.status, 400);
  assert.equal(outcome.message, "Ongeldige invoer.");
  assert.doesNotMatch(outcome.body, /not-an-email|Schrijf minimaal|Naam is/);
  assert.deepEqual(outcome.unexpected, {
    internal: true,
    message: "Veilige algemene foutmelding.",
    status: 500,
  });
  assert.doesNotMatch(outcome.unexpected.message, /super-secret|postgres/);
  assert.deepEqual(outcome.replayExpired, {
    internal: false,
    message: "De tijdelijke toegang tot deze bestelling is verlopen.",
    status: 410,
  });
  assert.deepEqual(outcome.replayUnavailable, {
    internal: false,
    message:
      "De bestaande bestelling kan niet veilig opnieuw worden geopend. Neem contact op met de beheerder.",
    status: 503,
  });
});

test("admin login combines a constant minimum with progressive failure backoff", async () => {
  const outcome = await withPage((page) =>
    page.evaluate(
      async ({ password }) => {
        const { loginAdmin } = await import("/src/lib/server/admin.ts");
        const invoke = async (candidate) => {
          const startedAt = performance.now();
          let status = 0;
          try {
            await loginAdmin({
              data: { password: candidate },
              fetch: async (url, init) => {
                const response = await fetch(url, init);
                status = response.status;
                return response;
              },
            });
            return {
              duration: performance.now() - startedAt,
              status,
              ok: true,
            };
          } catch (error) {
            return {
              duration: performance.now() - startedAt,
              status,
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            };
          }
        };
        return {
          first: await invoke("verkeerd-1"),
          second: await invoke("verkeerd-2"),
          third: await invoke("verkeerd-3"),
          success: await invoke(password),
        };
      },
      { password: TEST_ADMIN_PASSWORD },
    ),
  );

  assert.equal(outcome.first.status, 401);
  assert.equal(outcome.second.status, 401);
  assert.equal(outcome.third.status, 401);
  assert.equal(outcome.success.status, 200);
  assert.equal(outcome.success.ok, true);
  assert.ok(outcome.first.duration >= 220, JSON.stringify(outcome));
  assert.ok(outcome.second.duration >= 450, JSON.stringify(outcome));
  assert.ok(outcome.third.duration >= 900, JSON.stringify(outcome));
  assert.ok(outcome.success.duration >= 220, JSON.stringify(outcome));
});
