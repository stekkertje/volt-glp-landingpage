import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "vite";

let vite;
let getSql;
let storeContactMessage;
let listContactMessageRecords;
let setContactHandledRecord;

before(async () => {
  vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({
    storeContactMessage,
    listContactMessageRecords,
    setContactHandledRecord,
  } = await vite.ssrLoadModule("/src/lib/server/contact.server.ts"));
});

after(async () => {
  await vite?.close();
});

test("contact stores a validated message and admin can mark it handled", async () => {
  const unique = randomUUID();
  const email = `CONTACT+${unique}@EXAMPLE.TEST`;
  await storeContactMessage(
    {
      name: "  Noor de Vries ",
      email,
      message: "  Dit is een geldig contactbericht.  ",
    },
    `test-${unique}`,
  );

  const sql = await getSql();
  const stored = await sql.query(
    `select id, name, email, message, handled, handled_at
     from contact_messages where email = $1`,
    [email.toLowerCase()],
  );
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, "Noor de Vries");
  assert.equal(stored[0].message, "Dit is een geldig contactbericht.");
  assert.equal(stored[0].handled, false);
  assert.equal(stored[0].handled_at, null);

  const open = await listContactMessageRecords({
    handled: false,
    page: 1,
    pageSize: 20,
  });
  assert.ok(open.messages.some((message) => message.id === stored[0].id));

  const updated = await setContactHandledRecord(stored[0].id, true);
  assert.equal(updated.handled, true);
  assert.ok(updated.handledAt);
});
