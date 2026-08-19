import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { readdir } from "node:fs/promises";

const environment = { ...process.env };
const protectedNames = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "MIGRATION_DATABASE_URL",
  "TEST_MIGRATION_DATABASE_URL",
  "NEON_API_KEY",
  "BETTER_AUTH_SECRET",
  "ORDER_ACCESS_TOKEN_SECRET",
  "ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS",
  "ADMIN_EMAILS",
  "ADMIN_PASSWORD",
  "ADMIN_SESSION_SECRET",
  "MAILBOX_ADDRESS",
  "MAILBOX_PASSWORD",
  "MAIL_TEST_RECIPIENT",
  "HOSTINGER_API_TOKEN",
  "CLOUDFLARE_API_TOKEN",
  "NITRO_PRESET",
  "NO_INDEX",
  "VITE_NO_INDEX",
  "VITE_PUBLIC_HOSTNAME",
  "VITE_AUTH_ENABLED",
  "TRUST_HOSTINGER_PROXY",
];

for (const name of protectedNames) delete environment[name];
Object.assign(environment, {
  NODE_ENV: "test",
  npm_lifecycle_event: "test",
  REQUIRE_DATABASE: "",
  VERCEL: "",
  NETLIFY: "",
  PGLITE_PREVIEW: "",
});

const serialTestFiles = new Set([
  "scripts/auth-disabled-deployment.test.mjs",
  "scripts/production-runtime.test.mjs",
  "scripts/security-rpc.test.mjs",
  "scripts/storefront.test.mjs",
]);
const discoveredTestFiles = (await readdir(new URL(".", import.meta.url)))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => `scripts/${name}`);
const runnerArguments = process.argv.slice(2);
const nodeTestOptions = runnerArguments.filter((name) => name.startsWith("--"));
const requestedTestFiles = runnerArguments
  .filter((name) => !name.startsWith("--"))
  .map((name) => (name.startsWith("scripts/") ? name : `scripts/${name}`));
const unknownTestFiles = requestedTestFiles.filter(
  (name) => !discoveredTestFiles.includes(name),
);
if (unknownTestFiles.length > 0) {
  throw new Error(`Onbekende testbestanden: ${unknownTestFiles.join(", ")}`);
}
const testFiles =
  requestedTestFiles.length > 0 ? requestedTestFiles : discoveredTestFiles;
const parallelTestFiles = testFiles.filter(
  (name) => !serialTestFiles.has(name),
);
const existingSerialTestFiles = testFiles.filter((name) =>
  serialTestFiles.has(name),
);

async function runTestFiles(files, concurrency) {
  if (files.length === 0) return 0;
  const child = spawn(
    process.execPath,
    [
      "--test",
      `--test-concurrency=${concurrency}`,
      ...nodeTestOptions,
      ...files,
    ],
    {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
    },
  );
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
}

// Fast unit/module suites still run concurrently. Browser suites and the one
// suite that rebuilds the production bundle run one-by-one, preventing the
// Vite/Chromium contention that made storefront timing assertions flaky.
const parallelConcurrency = Math.max(1, Math.min(4, availableParallelism()));
let exitCode = await runTestFiles(parallelTestFiles, parallelConcurrency);
if (exitCode === 0) {
  exitCode = await runTestFiles(existingSerialTestFiles, 1);
}
process.exit(exitCode);
