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
| `scripts/storefront.test.mjs` | Browserregressies |

## Open gaten

Niet hele branches mergen. Alleen deze vijf punten. Filter-sticky, 5-thumbs-rij en de meeste e2e-flows zitten al in `main`.

1. **Cart-persist zonder SSR-flikker**
   Bron: `cursor/volt-glp-shop-fixes-e10e`
   `src/lib/cart-store.ts` + nieuw `src/components/cart-hydrate.tsx`
   Zet `skipHydration: true` en roep `useCartStore.persist.rehydrate()` in `useEffect` aan.

2. **Max 10 stuks ook in addToCart en setLineQty**
   Bron: e10e, `src/lib/cart-store.ts`
   De stepper is begrensd. `addToCart` / `setLineQty` nog niet. `MAX_LINE_QTY = 10`. Plus-knop disabled bij 10.

3. **Gerelateerd alleen dezelfde stof**
   Bron: `cursor/complete-conversion-review-0cd3`, `relatedProducts()` in `src/lib/product.ts`
   Nu: zusje + andere GLP-1's, kop "Vergelijk meer producten".
   Moet: alleen zelfde `subcat`, kop "Andere sterkte / vorm".

4. **Exact aantal spuiten in de copy**
   Bron: e10e, `SYRINGE_PACK_COUNT` in `product.ts` + `pack-selector.tsx`
   Nu: "set voor injecties". Moet: set van X stuks.

5. **Dialog-focus strakker**
   Bron: 0cd3, `src/lib/use-dialog-focus.ts`
   Alleen toevoegen: `body { overflow: hidden }`, `requestAnimationFrame` voor focus, `[data-dialog-autofocus]`.

### Niet doen

- Hele branches mergen
- Foto's wissen of terugzetten
- `GROK.md` overschrijven
- e10e `cutoff.ts` (main is slimmer: echte volgende werkdag)
- `scripts/shop-qa.mjs` van e10e
- Filter-store, gallery-grid of extra e2e overnemen. Dat zit al in `main`.

### Check

- Refresh: winkelwagen blijft, geen hydration-fout in de console
- 11x toevoegen blijft op 10
- Semaglutide-PDP toont alleen het Semaglutide-zusje, geen andere stof
- Spuiten-optie noemt het aantal
- Contact/cart: body-scroll lock, focus na open, Escape sluit
