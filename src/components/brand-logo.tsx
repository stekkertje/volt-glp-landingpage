import { SITE } from "@/lib/product";
import { cn } from "@/lib/utils";

export const BRAND_LOGO = {
  light: {
    full: "/images/brand/logo-light.png",
    stacked: "/images/brand/logo-stacked-light.png",
    lockup: "/images/brand/logo-lockup-light.png",
    mark: "/images/brand/mark-light.png",
  },
  dark: {
    full: "/images/brand/logo-dark.png",
    stacked: "/images/brand/logo-stacked-dark.png",
    lockup: "/images/brand/logo-lockup-dark.png",
    mark: "/images/brand/mark-dark.png",
  },
} as const;

type BrandLogoLayout = keyof typeof BRAND_LOGO.light;

export function BrandLogo({
  variant = "light",
  layout = "lockup",
  alt = SITE.brand,
  className,
}: {
  variant?: "light" | "dark";
  layout?: BrandLogoLayout;
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={BRAND_LOGO[variant][layout]}
      alt={alt}
      className={cn("block h-auto w-auto select-none", className)}
    />
  );
}
