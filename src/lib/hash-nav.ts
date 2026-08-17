export const PRODUCT_HASHES = new Set([
  "semaglutide",
  "tirzepatide",
  "retatrutide",
  "producten",
]);

/** Same-page compound links do not fire hashchange. Scroll the grid anyway. */
export function handleShopHashClick(
  href: string,
  extra?: () => void,
): (event: { preventDefault: () => void }) => void {
  return (event) => {
    extra?.();
    if (typeof window === "undefined") return;
    const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1).toLowerCase() : "";
    if (!PRODUCT_HASHES.has(hash)) return;
    if (window.location.pathname !== "/") return;
    if (window.location.hash.replace("#", "").toLowerCase() !== hash) return;
    event.preventDefault();
    document.getElementById("producten")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}
