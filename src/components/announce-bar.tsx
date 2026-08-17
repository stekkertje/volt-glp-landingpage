const ITEMS = [
  "Gratis verzending vanaf €100",
  "Voor 23:00 besteld, morgen verzonden",
  "Discreet verpakt",
] as const;

export function AnnounceBar() {
  const track = [...ITEMS, ...ITEMS, ...ITEMS, ...ITEMS];

  return (
    <div className="relative overflow-hidden bg-fg text-bg">
      <div className="relative flex h-9 items-center">
        <div className="announce-marquee flex min-w-max items-center gap-8 text-[11px] font-semibold tracking-wide sm:text-xs">
          {track.map((item, i) => (
            <span key={`${item}-${i}`} className="inline-flex items-center gap-8 shrink-0">
              <span>{item}</span>
              <span className="text-bg/35" aria-hidden>
                ·
              </span>
            </span>
          ))}
        </div>
      </div>
      <style>{`
        @keyframes volt-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .announce-marquee {
          animation: volt-marquee 28s linear infinite;
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .announce-marquee {
            animation: none;
            justify-content: center;
            width: 100%;
            min-width: 0;
            flex-wrap: wrap;
            gap: 0.5rem 1.5rem;
            padding: 0 1rem;
          }
        }
      `}</style>
    </div>
  );
}
