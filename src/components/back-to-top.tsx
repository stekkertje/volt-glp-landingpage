import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

export function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-[calc(6rem+var(--volt-cookie-h,0px))] right-3 z-40 flex size-11 items-center justify-center rounded-full border border-border bg-surface text-fg shadow-md transition hover:border-primary hover:text-primary md:bottom-[calc(1.5rem+var(--volt-cookie-h,0px))] md:right-6"
      aria-label="Terug naar boven"
    >
      <ArrowUp className="size-5" />
    </button>
  );
}
