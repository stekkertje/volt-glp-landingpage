type CartLifecycleStorage = Pick<Storage, "getItem" | "setItem">;

export const COMPLETED_CART_EPOCH_STORAGE_KEY = "volt-cart-completed-epoch-v1";
export const INITIAL_CART_EPOCH = 1;

function browserCartLifecycleStorage(): CartLifecycleStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isValidCartEpoch(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= INITIAL_CART_EPOCH
  );
}

export type CompletedCartEpochRead =
  { ok: true; completedEpoch: number } | { ok: false };

export function readCompletedCartEpoch(
  storage: CartLifecycleStorage | null = browserCartLifecycleStorage(),
): CompletedCartEpochRead {
  if (!storage) return { ok: false };
  try {
    const raw = storage.getItem(COMPLETED_CART_EPOCH_STORAGE_KEY);
    if (raw === null) return { ok: true, completedEpoch: 0 };
    const parsed: unknown = JSON.parse(raw);
    return isValidCartEpoch(parsed)
      ? { ok: true, completedEpoch: parsed }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function persistCompletedCartEpoch(
  cartEpoch: number,
  storage: CartLifecycleStorage | null = browserCartLifecycleStorage(),
): boolean {
  if (!isValidCartEpoch(cartEpoch) || !storage) return false;
  const current = readCompletedCartEpoch(storage);
  if (!current.ok) return false;
  const completedEpoch = Math.max(current.completedEpoch, cartEpoch);
  try {
    storage.setItem(
      COMPLETED_CART_EPOCH_STORAGE_KEY,
      JSON.stringify(completedEpoch),
    );
    const verified = readCompletedCartEpoch(storage);
    return verified.ok && verified.completedEpoch >= cartEpoch;
  } catch {
    return false;
  }
}

export function nextCartEpoch(
  cartEpoch: number,
  storage: CartLifecycleStorage | null = browserCartLifecycleStorage(),
): number {
  const current = isValidCartEpoch(cartEpoch) ? cartEpoch : INITIAL_CART_EPOCH;
  const completed = readCompletedCartEpoch(storage);
  const floor = completed.ok
    ? Math.max(current, completed.completedEpoch)
    : current;
  if (floor >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Winkelwagengeneratie kan niet veilig worden vernieuwd.");
  }
  return floor + 1;
}
