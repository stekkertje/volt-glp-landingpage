# VOLT GLP-1 shop

Nederlandse webshop voor Semaglutide, Tirzepatide en Retatrutide. Elke stof als vial of kant-en-klare pen.

Checkout en contact schrijven naar de database. Betaling en e-mailafhandeling blijven handmatig.

Agent-briefing (eerst lezen als je hieraan werkt): [`GROK.md`](./GROK.md)

## Stack

React 19, TypeScript, Vite 8, TanStack Start / Router, Tailwind v4, Zustand.

```bash
npm install
npm run dev          # 0.0.0.0:8080
npm run build
npm run typecheck
npm run lint
npm test
```

Deploy-target: Vercel SSR. Geen Hostinger shared hosting zonder extra export.

## Productie en beheer

- `DATABASE_URL` is verplicht in iedere production runtime en deployment.
- PGLite wordt uitsluitend gebruikt tijdens lokale development en tests.
- `ORDER_ACCESS_TOKEN_SECRET` is verplicht naast een persistente database en
  moet een afzonderlijk, stabiel geheim van minimaal 32 tekens zijn. Genereer
  bijvoorbeeld 32 willekeurige bytes; hergebruik `DATABASE_URL` of een
  authenticatiegeheim niet.
- Draai dit geheim veilig door eerst de nieuwe waarde in
  `ORDER_ACCESS_TOKEN_SECRET` te zetten en de vorige waarde tijdelijk op te
  nemen in `ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS` (kommagescheiden). Laat oude
  waarden minimaal 72 uur staan. Een replay versleutelt een geldige code
  automatisch opnieuw met de actuele sleutel zonder die code in te trekken.
- Admin via Better Auth: zet `ADMIN_EMAILS` op een kommagescheiden allowlist.
- Admin via wachtwoord: zet zowel `ADMIN_PASSWORD` als `ADMIN_SESSION_SECRET`.
- In productie is het wachtwoord minimaal 16 tekens en het sessiegeheim minimaal 32 tekens.
- Beide adminmethoden kunnen naast elkaar bestaan. Geen van deze variabelen is client-side.

### Database-upgradecontrole

Migratie `0007_review_hardening.sql` stopt bewust wanneer historische
bestellingen dezelfde productvariant meer dan eenmaal bevatten. Controleer dit
voor een productie-upgrade:

```sql
select order_id, slug, option_id, count(*) as aantal
from order_lines
group by order_id, slug, option_id
having count(*) > 1;
```

Los iedere gevonden bestelling handmatig en controleerbaar op voordat de
migratie opnieuw draait. De migratie verwijdert of combineert nooit stil
historische orderregels.

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

## Backendroutes

- `/checkout`: gastbestelling met serverprijzen en idempotency.
- `/bestelling/$id`: beveiligde bevestiging via eigenaar, admin of tijdelijk gastbewijs.
- `/account`: eigen orders na login of gasttoegang met herstelcode.
- `/admin`: dagelijkse order- en contactafhandeling.

## Bewust handmatig

Er is nog geen betaalprovider, automatische e-mail, voorraadbeheer, refundflow of verzendkoppeling.
