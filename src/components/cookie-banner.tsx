import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const KEY = "volt-cookie-consent";
const COOKIE_H_VAR = "--volt-cookie-h";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      document.documentElement.style.removeProperty(COOKIE_H_VAR);
      return;
    }
    const updateHeight = () => {
      const height = bannerRef.current?.offsetHeight ?? 0;
      document.documentElement.style.setProperty(COOKIE_H_VAR, `${height}px`);
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    if (bannerRef.current) observer.observe(bannerRef.current);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(COOKIE_H_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  const accept = () => {
    try {
      localStorage.setItem(KEY, "accepted");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  return (
    <div
      ref={bannerRef}
      className="fixed inset-x-0 bottom-0 z-[65] border-t border-border bg-surface/95 p-4 shadow-[0_-8px_30px_-12px_rgba(20,19,26,0.18)] backdrop-blur-xl md:p-5"
      role="region"
      aria-label="Functionele opslag"
    >
      <div className="container-max flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted max-w-2xl">
          We gebruiken alleen functionele opslag om je winkelwagen en voorkeuren
          te onthouden. <span className="text-fg">Geen tracking.</span>
        </p>
        <div className="flex shrink-0">
          <Button size="sm" onClick={accept}>
            Begrepen
          </Button>
        </div>
      </div>
    </div>
  );
}
