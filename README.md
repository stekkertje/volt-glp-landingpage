# VOLT GLP-1 shop

Nederlandse webshop voor Semaglutide, Tirzepatide en Retatrutide. Elke stof als vial of kant-en-klare pen.

Checkout en contact schrijven naar de database. Transactionele e-mail,
klantaccounts, adrescontrole en MyParcel-verzending zijn in de backend
opgenomen. Betaling blijft handmatig.

AI-beheer:

- Codex: [`AGENTS.override.md`](./AGENTS.override.md) en
  [`docs/WEBSITE-OPERATIONS.md`](./docs/WEBSITE-OPERATIONS.md)
- Grok: [`GROK.md`](./GROK.md)
- Review: [`docs/REVIEW-CHECKLIST.md`](./docs/REVIEW-CHECKLIST.md)
- Duurzame beslissingen: [`docs/DECISIONS.md`](./docs/DECISIONS.md)

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

Deploy-targets: Vercel SSR als standaard en Hostinger Cloud Node.js via de
aparte `build:hostinger`-build. Zie [`DEPLOY-HOSTINGER.md`](./DEPLOY-HOSTINGER.md).

## Productie en beheer

- `DATABASE_URL` is verplicht in iedere production runtime en deployment.
- `MIGRATION_DATABASE_URL` (of de door sommige integraties geleverde
  `DATABASE_URL_UNPOOLED`) is daarnaast verplicht voor deploymigraties en moet
  de directe/unpooled PostgreSQL-URL met een expliciete niet-lege gebruiker en
  wachtwoord zijn. De migrator gebruikt nooit de OS-gebruiker of `~/.pgpass`
  als credentialfallback. Gebruik voor de Hostinger/Neon-runtime een directe,
  unpooled `DATABASE_URL`: de app pint `search_path=public` bij het verbinden en
  Neons transaction-pooler accepteert die startupoptie niet. De migrator
  weigert bekende pooler-URL's omdat zijn session advisory lock één vaste
  databaseverbinding nodig heeft. Bij Neon
  moeten runtime- en migratie-URL aantoonbaar dezelfde branch en database
  aanwijzen; een afzonderlijke migratierol/gebruikersnaam is wel toegestaan.
  Zet de database altijd in het URL-pad (`/...`) zoals `pg` dat werkelijk
  interpreteert. Een afwijkende `?database=...`-query wordt vóór verbinden
  geweigerd. Het standaardschema is `public`. Wanneer de URL-instelling
  `options=-c search_path=...` wordt gebruikt, moeten runtime en migrator exact
  dezelfde veilige schemazoekvolgorde krijgen. De migrator controleert vóór
  wijzigingen ook het werkelijk actieve schema; zonder expliciete instelling
  pinnen migrator, runtime en auth `search_path=public`, onafhankelijk van
  roldefaults. Geef de migrator geen losse
  `PGHOST`/`PGPORT`/`PGDATABASE`/`PGOPTIONS` of andere connection-affecting
  `PG*`-omgevingsvariabelen: alle verbindingsinstellingen horen expliciet in de
  directe migratie-URL. Openen, sluiten en wachten op de
  advisory-lock zijn begrensd. Wachten op een gewone PostgreSQL-lock is per
  statement maximaal 15 seconden; een actief uitgevoerd migratiestatement
  krijgt geen algemene `statement_timeout`. Zet daarom geen `statement_timeout`,
  `query_timeout` of `lock_timeout` in de directe migratie-URL of de
  `options`-parameter; de migrator voegt uitsluitend zijn eigen
  `lock_timeout=15000` toe.
- De GitHub-check **Migration integration** start bij iedere push en pull request
  een tijdelijke PostgreSQL-service. Daarmee draaien ook de echte
  advisory-lock- en concurrencytests, een echte geblokkeerde statement-locktest
  én de volledige productiemigrator inclusief 0007 `CREATE INDEX CONCURRENTLY`.
  De migrator draait daar tweemaal en de tweede run moet idempotent zijn. Lokaal
  blijven deze tests alleen overgeslagen wanneer
  `TEST_MIGRATION_DATABASE_URL` niet is ingesteld.
- PGLite wordt uitsluitend gebruikt tijdens lokale development en tests.
- Gebruik bij voorkeur een afzonderlijk, stabiel
  `ORDER_ACCESS_TOKEN_SECRET` van minimaal 32 tekens naast een persistente
  database. Wanneer dit niet is ingesteld, gebruikt de app het eveneens
  stabiele `BETTER_AUTH_SECRET` via een domeingescheiden sleutelafleiding.
  Minstens één van beide moet aanwezig zijn; `DATABASE_URL` wordt nooit als
  actuele versleutelingssleutel gebruikt.
- Draai dit geheim veilig door eerst de nieuwe waarde in
  `ORDER_ACCESS_TOKEN_SECRET` te zetten en de vorige waarde tijdelijk op te
  nemen in `ORDER_ACCESS_TOKEN_PREVIOUS_SECRETS` (kommagescheiden). Laat oude
  waarden minimaal 72 uur staan. Een replay versleutelt een geldig gastbewijs
  automatisch opnieuw met de actuele sleutel zonder het bewijs in te trekken.
  Roteer je `BETTER_AUTH_SECRET` terwijl dit ook de fallback voor besteltoegang
  is, neem dan de vorige authwaarde tijdelijk in diezelfde previous-secretslijst
  op of stel vooraf een aparte ordersleutel in.
- Admin via Better Auth: zet `ADMIN_EMAILS` op een kommagescheiden allowlist.
- Google/X OAuth is in productie expliciet opt-in via
  `VITE_OAUTH_ENABLED=true` plus beide server-only waarden
  `GROK_AUTH_CLIENT_ID` en `GROK_AUTH_CLIENT_SECRET`. Zonder die configuratie
  gebruikt de shop alleen e-mail/wachtwoord; de Grok-previewclient is nooit een
  fallback voor het publieke domein.
- Admin via wachtwoord: zet `ADMIN_SESSION_SECRET` en exact één van
  `ADMIN_PASSWORD` of `ADMIN_PASSWORD_BASE64`. Gebruik op Hostinger bij voorkeur
  base64/base64url, zodat speciale tekens transportveilig blijven; het
  ingevoerde wachtwoord zelf verandert niet.
- In productie is het wachtwoord minimaal 16 tekens en het sessiegeheim minimaal 32 tekens.
- Beide adminmethoden kunnen naast elkaar bestaan. Geen van deze variabelen is client-side.

### Hostinger Cloud

- Gebruik Node.js 22 en `npm ci --include=dev`. Zet
  `NPM_CONFIG_INCLUDE=dev`, omdat de buildtoolchain ook onder
  `NODE_ENV=production` nodig is.
- Build met `npm run build:hostinger`; dit selecteert Nitro `node-server` en
  voert daarna de databasemigraties uit.
- Start met `npm start` (`.output/server/index.mjs`).
- Hostinger gebruikt een externe PostgreSQL-database. Voor deze deployment is
  dat Neon; Hostinger MySQL is niet compatibel met deze PostgreSQL-code.
- Houd de testsite uit zoekmachines met zowel `VITE_NO_INDEX=1` als
  `NO_INDEX=1`. De eerste levert de robots-meta tijdens de build, de tweede de
  globale `X-Robots-Tag` tijdens runtime.
- De volledige configuratie en live checklist staan in
  [`DEPLOY-HOSTINGER.md`](./DEPLOY-HOSTINGER.md).

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

| Product           | Vorm |             Prijs |
| ----------------- | ---- | ----------------: |
| Semaglutide 2 mg  | vial |            €85,00 |
| Semaglutide 4 mg  | pen  |           €169,00 |
| Tirzepatide 10 mg | vial |            €94,00 |
| Tirzepatide 20 mg | pen  |           €190,00 |
| Retatrutide 10 mg | vial | €77,60 (weekdeal) |
| Retatrutide 20 mg | pen  |           €199,00 |

- Gratis verzending vanaf €100, anders €4,95
- NL en BE, 1-2 werkdagen, discreet, track & trace
- Stapelkorting: 5+ = 10%, 10+ = 20%
- Code `VOLT10`: 10% extra na stapelkorting
- Default: Semaglutide 4 mg pen

## Belangrijkste bestanden

| Bestand                                | Rol                        |
| -------------------------------------- | -------------------------- |
| `src/components/landing-page.tsx`      | Homepage + catalogus       |
| `src/components/product-page.tsx`      | Productdetail              |
| `src/lib/product.ts`                   | Productdata, FAQ, reviews  |
| `src/lib/cart-store.ts`                | Winkelwagen (client, demo) |
| `src/components/pack-selector.tsx`     | Extra's, aantal, CTA       |
| `src/components/mobile-sticky-bar.tsx` | Mobiele koopbalk           |
| `src/components/cart-drawer.tsx`       | Winkelwagen-drawer         |
| `public/images/producten/`             | Productfoto's              |
| `scripts/storefront.test.mjs`          | Browserregressies          |

## Backendroutes

- `/checkout`: gast- of accountbestelling met serverprijzen, adrescontrole en idempotency.
- `/bestelling/$id`: beveiligde bevestiging via account, admin of de eigen
  host-only HttpOnly-gastcookie van die checkout.
- `/account`: klantaccount met bestelgeschiedenis, adres, tracking en veilige e-mailclaim van eerdere gastorders.
- `/admin`: dagelijkse order-, contact-, mail- en MyParcel-afhandeling.

## Bewust handmatig

Er is nog geen betaalprovider, voorraadbeheer of refundflow. Transactionele
e-mail loopt via de database-outbox. MyParcel-concepten, A6-labels en tracking
zijn beheeracties; een label wordt nooit stil tijdens checkout aangemaakt.
