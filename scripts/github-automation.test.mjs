import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readWorkflow = (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

test("Codex reviews use only trusted instructions from the base commit", async () => {
  const workflow = await readWorkflow("codex-review.yml");

  assert.match(workflow, /git worktree add --detach "\$REVIEW_WORKTREE" HEAD/);
  assert.match(workflow, /git show "\$BASE_SHA:\$path"/);
  assert.match(workflow, /-name AGENTS\.md -o -name AGENTS\.override\.md/);
  assert.doesNotMatch(workflow, /--ignore-user-config/);
  assert.doesNotMatch(workflow, /--ignore-rules/);
  assert.match(
    workflow,
    /working-directory: \$\{\{ runner\.temp \}\}\/codex-review-worktree/,
  );
  assert.doesNotMatch(workflow, /--cd/);
  assert.match(
    workflow,
    /if: steps\.trusted-prompt\.outputs\.available == 'true'/,
  );
});

test("Codex maintenance publishes a non-hidden verified patch", async () => {
  const workflow = await readWorkflow("codex-maintenance.yml");

  assert.match(workflow, /> codex-maintenance\.patch/);
  assert.match(workflow, /path: codex-maintenance\.patch/);
  assert.match(workflow, /git apply --index codex-maintenance\.patch/);
  assert.doesNotMatch(workflow, /\.codex-maintenance\.patch/);
});
