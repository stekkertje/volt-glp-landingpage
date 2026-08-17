import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stars({
  rating,
  size = "md",
  className,
}: {
  rating: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const dim = size === "sm" ? "size-3.5" : "size-4";
  return (
    <div className={cn("flex items-center gap-0.5", className)} aria-label={`${rating} van 5 sterren`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(dim, i < Math.round(rating) ? "fill-star text-star" : "text-border-strong")}
        />
      ))}
    </div>
  );
}
