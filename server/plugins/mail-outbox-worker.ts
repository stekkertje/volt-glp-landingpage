import { resolveMailConfiguration } from "../../src/lib/server/mail/config.server";
import { processMailOutbox } from "../../src/lib/server/mail/worker.server";

const globalWorker = globalThis as typeof globalThis & {
  __voltMailOutboxTimer__?: ReturnType<typeof setInterval>;
  __voltMailOutboxBusy__?: boolean;
};

async function tick(): Promise<void> {
  if (globalWorker.__voltMailOutboxBusy__) return;
  globalWorker.__voltMailOutboxBusy__ = true;
  try {
    const result = await processMailOutbox({ limit: 10 });
    if (result.failed > 0) {
      console.error(
        `[mail-outbox] ${result.failed} bericht(en) vereisen handmatige controle.`,
      );
    }
  } catch {
    // The persisted outbox is the source of truth. A later tick continues
    // pending work and marks stale sending claims uncertain, never auto-resend.
    // Never log SMTP errors, recipients or message content from this path.
    console.error(
      "[mail-outbox] Verwerking mislukt; een volgende ronde probeert opnieuw.",
    );
  } finally {
    globalWorker.__voltMailOutboxBusy__ = false;
  }
}

export default function mailOutboxWorkerPlugin(): void {
  if (!resolveMailConfiguration(process.env)) return;
  if (globalWorker.__voltMailOutboxTimer__) return;
  void tick();
  globalWorker.__voltMailOutboxTimer__ = setInterval(() => void tick(), 30_000);
  globalWorker.__voltMailOutboxTimer__.unref?.();
}
