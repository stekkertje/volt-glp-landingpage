# VOLT GLP-1 shop

Nederlandse webshop voor Semaglutide, Tirzepatide en Retatrutide. Elke stof als vial of kant-en-klare pen.

Cart, contact en checkout zijn **demo**. Geen echte betaling of mail.

Agent-briefing (eerst lezen als je hieraan werkt): [`GROK.md`](./GROK.md)

## Stack

React 19, TypeScript, Vite 8, TanStack Start / Router, Tailwind v4, Zustand.

```bash
npm install
npm run dev          # 0.0.0.0:8080
npm run build
npm run typecheck
```

Deploy-target: Vercel SSR. Geen Hostinger shared hosting zonder extra export.

## Catalogus

| Product | Vorm | Prijs |
| --- | --- | ---: |
| Semaglutide 2 mg | vial | €85,00 |
| Semaglutide 4 mg | pen | €169,00 |
| Tirzepatide 10 mg | vial | €94,00 |
| Tirzepatide 20 mg | pen | €190,00 |
| Retatrutide 10 mg | vial | €77,60 (weekdeal) |
| Retatrutide 20 mg | pen | €199,00 |

- Gratis verzending vanaf €100, anders €4,95
- NL en BE, 1-2 werkdagen, discreet, track & trace
- Stapelkorting: 5+ = 10%, 10+ = 20%
- Code `VOLT10`: 10% extra na stapelkorting
- Default: Semaglutide 4 mg pen

## Belangrijkste bestanden

| Bestand | Rol |
| --- | --- |
| `src/components/landing-page.tsx` | Homepage + catalogus |
| `src/components/product-page.tsx` | Productdetail |
| `src/lib/product.ts` | Productdata, FAQ, reviews |
| `src/lib/cart-store.ts` | Winkelwagen (client, demo) |
| `src/components/pack-selector.tsx` | Extra's, aantal, CTA |
| `src/components/mobile-sticky-bar.tsx` | Mobiele koopbalk |
| `src/components/cart-drawer.tsx` | Winkelwagen-drawer |
| `public/images/producten/` | Productfoto's |

## Open gaten (niet mergen, overnemen)

`main` is `cursor/complete-shop-audit-d2b5`. De 16 reviewpunten zitten erin. Andere takken niet heel mergen. Alleen deze gaten:

### P1

1. **Cart-persist zonder SSR-flikker**
   Bron: `cursor/volt-glp-shop-fixes-e10e`
   `src/lib/cart-store.ts` + nieuw `src/components/cart-hydrate.tsx`
   Main heeft `persist`, mist `skipHydration: true` en `CartHydrate` (`rehydrate()` in `useEffect`).

2. **Max 10 stuks per regel**
   Bron: e10e, `src/lib/cart-store.ts`
   Stepper is begrensd, `addToCart` / `setLineQty` niet. Zet `MAX_LINE_QTY = 10` op add + setLineQty. Plus-knop disabled bij 10.

3. **Gerelateerd alleen dezelfde stof**
   Bron: `cursor/complete-conversion-review-0cd3`, `relatedProducts()` in `src/lib/product.ts`
   Main toont daarna ook andere GLP-1's. Kop nu: "Vergelijk meer producten". Moet: alleen zelfde `subcat`, kop "Andere sterkte / vorm".

4. **Sticky balk volgt het stof-filter**
   Bron: e10e
   `src/lib/catalog-filter.ts`, `landing-page.tsx`, `mobile-sticky-bar.tsx`
   Filter is nu lokale state. Sticky toont `selectedSlug` (vaak Semaglutide-pen) ook als je op Retatrutide filtert.

### P2

5. **Aantal spuiten in de copy**
   Bron: e10e, `SYRINGE_PACK_COUNT` in `product.ts` + `pack-selector.tsx`

6. **5 gallery-thumbs op 1 rij**
   Bron: `cursor/volt-glp-shop-afronding-b099`, `product-gallery.tsx`
   Retatrutide-pen heeft 5 foto's.

7. **Dialog-focus strakker**
   Bron: 0cd3, `src/lib/use-dialog-focus.ts`
   Alleen overnemen: `body { overflow: hidden }`, `requestAnimationFrame` voor focus, `[data-dialog-autofocus]`.

### Niet doen

- Hele branches mergen
- Foto's wissen of terugzetten
- `GROK.md` overschrijven
- e10e `cutoff.ts` (main's cutoff is slimmer: echte volgende werkdag)
- `scripts/shop-qa.mjs` van e10e (zoekt knop "Accepteren", UI zegt "Begrepen")
- `cursor/setup-dev-environment-ddd5`, `fbac`, `ef11`, `8cfd`

### Check

- Refresh: winkelwagen blijft, geen hydration-fout
- 11x toevoegen blijft op 10
- Semaglutide-PDP toont alleen het Semaglutide-zusje
- Home + filter Retatrutide + scroll: sticky toont Retatrutide
- Spuiten-optie noemt het aantal
- 5 thumbs op de Retatrutide-pen op 1 rij
