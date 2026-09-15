import {
  Zap,
  Crosshair,
  Gauge,
  Pill,
  Clock3,
  ShieldCheck,
  FlaskConical,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  zap: Zap,
  focus: Crosshair,
  gauge: Gauge,
  capsule: Pill,
  clock: Clock3,
  shield: ShieldCheck,
  flask: FlaskConical,
};

export function BenefitIcon({ name, className }: { name: string; className?: string }) {
  const Icon = MAP[name] ?? Zap;
  return <Icon className={className} strokeWidth={1.75} />;
}
