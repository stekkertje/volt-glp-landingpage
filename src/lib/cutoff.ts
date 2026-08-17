export const CUTOFF_HOUR = 23;

export function isPastCutoff(now = new Date()) {
  return now.getHours() >= CUTOFF_HOUR;
}

export function msUntilCutoff(now = new Date()) {
  const cutoff = new Date(now);
  cutoff.setHours(CUTOFF_HOUR, 0, 0, 0);
  if (now >= cutoff) return 0;
  return cutoff.getTime() - now.getTime();
}

export function formatCountdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
