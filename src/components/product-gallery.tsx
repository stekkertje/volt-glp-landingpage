import { useState } from "react";
import { cn } from "@/lib/utils";

export function ProductGallery({
  images,
  className,
}: {
  images: readonly { src: string; alt: string }[];
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const current = images[active] ?? images[0];
  if (!current) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm">
        <img
          key={current.src}
          src={current.src}
          alt={current.alt}
          className="aspect-square w-full max-h-[420px] object-cover object-center"
        />
        {images.length > 1 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setActive(i)}
                className={cn(
                  "size-2 rounded-full transition cursor-pointer",
                  i === active ? "bg-primary w-5" : "bg-fg/30 hover:bg-fg/50",
                )}
                aria-label={`Afbeelding ${i + 1}`}
                aria-current={i === active}
              />
            ))}
          </div>
        )}
      </div>
      {images.length > 1 && (
        <div className={cn("grid gap-2", images.length >= 4 ? "grid-cols-4" : "grid-cols-3")}>
          {images.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => setActive(i)}
              className={cn(
                "overflow-hidden rounded-lg border-2 transition cursor-pointer",
                i === active ? "border-primary shadow-2xs" : "border-transparent opacity-80 hover:opacity-100",
              )}
              aria-label={`Toon ${img.alt}`}
            >
              <img src={img.src} alt="" className="aspect-square w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
