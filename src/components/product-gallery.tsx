import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const SWIPE_PX = 48;

export function ProductGallery({
  images,
  className,
}: {
  images: readonly { src: string; alt: string }[];
  className?: string;
}) {
  const [active, setActive] = useState(0);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointerId = useRef<number | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"undecided" | "h" | "v">("undecided");
  const count = images.length;
  const current = images[active] ?? images[0];

  const goTo = useCallback(
    (index: number) => {
      if (count <= 1) return;
      setActive(((index % count) + count) % count);
    },
    [count],
  );

  const endDrag = (clientX: number) => {
    if (pointerId.current === null) return;
    const dx = clientX - startX.current;
    const usedHorizontal = axis.current === "h";
    pointerId.current = null;
    axis.current = "undecided";
    setDragging(false);
    setDragX(0);
    if (!usedHorizontal || count <= 1) return;
    if (dx <= -SWIPE_PX) goTo(active + 1);
    else if (dx >= SWIPE_PX) goTo(active - 1);
  };

  if (!current) return null;

  return (
    <div className={cn("space-y-3", className)}>
      <div
        ref={viewportRef}
        className="relative overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm touch-pan-y select-none"
        onPointerDown={(e) => {
          if (count <= 1) return;
          if (e.pointerType === "mouse" && e.button !== 0) return;
          pointerId.current = e.pointerId;
          startX.current = e.clientX;
          startY.current = e.clientY;
          axis.current = "undecided";
          setDragging(true);
          setDragX(0);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (pointerId.current !== e.pointerId) return;
          const dx = e.clientX - startX.current;
          const dy = e.clientY - startY.current;
          if (axis.current === "undecided") {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
            if (axis.current === "v") {
              pointerId.current = null;
              setDragging(false);
              setDragX(0);
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                /* already released */
              }
              return;
            }
          }
          if (axis.current === "h") setDragX(dx);
        }}
        onPointerUp={(e) => {
          if (pointerId.current !== e.pointerId) return;
          endDrag(e.clientX);
        }}
        onPointerCancel={(e) => {
          if (pointerId.current !== e.pointerId) return;
          pointerId.current = null;
          axis.current = "undecided";
          setDragging(false);
          setDragX(0);
        }}
        onKeyDown={(e) => {
          if (count <= 1) return;
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            goTo(active - 1);
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            goTo(active + 1);
          }
        }}
        role="region"
        aria-roledescription="carousel"
        aria-label="Productfoto's"
        tabIndex={count > 1 ? 0 : undefined}
      >
        <div
          className={cn(
            "flex",
            dragging ? "transition-none" : "transition-transform duration-200 ease-out",
          )}
          style={{
            transform: `translateX(calc(${-active * 100}% + ${dragX}px))`,
          }}
        >
          {images.map((img, i) => (
            <img
              key={img.src}
              src={img.src}
              alt={i === active ? img.alt : ""}
              width={800}
              height={800}
              draggable={false}
              fetchPriority={i === 0 ? "high" : undefined}
              className="aspect-square w-full max-h-[420px] shrink-0 object-cover object-center pointer-events-none"
            />
          ))}
        </div>
        {count > 1 && (
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                className={cn(
                  "size-2 rounded-full transition pointer-events-auto",
                  i === active ? "bg-primary w-5" : "bg-fg/30 hover:bg-fg/50",
                )}
                aria-label={`Afbeelding ${i + 1}`}
                aria-current={i === active}
              />
            ))}
          </div>
        )}
      </div>
      {count > 1 && (
        <div
          className={cn(
            "grid gap-2",
            count >= 5
              ? "grid-cols-5"
              : count === 4
                ? "grid-cols-4"
                : count === 3
                  ? "grid-cols-3"
                  : "grid-cols-2",
          )}
        >
          {images.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => goTo(i)}
              className={cn(
                "overflow-hidden rounded-lg border-2 transition",
                i === active
                  ? "border-primary"
                  : "border-transparent opacity-80 hover:opacity-100",
              )}
              aria-label={`Toon ${img.alt}`}
            >
              <img
                src={img.src}
                alt=""
                width={800}
                height={800}
                loading="lazy"
                draggable={false}
                className="aspect-square w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
