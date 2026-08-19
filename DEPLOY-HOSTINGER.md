# Deploy naar Hostinger Cloud met Neon

Deze branch houdt Vercel als standaard en voegt een aparte Nitro
`node-server`-build toe voor Hostinger Cloud Startup. Cloudflare is geen
onderdeel van deze deployment.

## Hostinger-instellingen

| Instelling                      | Waarde                                      |
| ------------------------------- | ------------------------------------------- |
| Application type                | `Nitro`, of `Other` wanneer Nitro ontbreekt |
| Node.js                         | `22`                                        |
| Root directory                  | `.`                                         |
| Install                         | `npm ci --include=dev`                      |
| Build script                    | `build:hostinger`                           |
| Build command, indien vrij veld | `npm run build:hostinger`                   |
| Output directory                | `.output`                                   |
| Entry file                      | `server/index.mjs`                          |
| Start command, indien gevraagd  | `npm start`                                 |

Hostinger beheert `PORT`. Stel die variabele alleen zelf in als hPanel dat
expliciet vraagt.

## Omgevingsvariabelen

Zet deze variabelen in de Hostinger Node.js-app. Bewaar waarden uitsluitend in
de secretomgeving, nooit in Git of buildlogs.

```dotenv
NODE_ENV=production
NPM_CONFIG_INCLUDE=dev
REQUIRE_DATABASE=1
DATABASE_URL=<Neon pooled URL>
MIGRATION_DATABASE_URL=<Neon direct/unpooled URL>
BETTER_AUTH_SECRET=<minimaal 32 tekens>
ORDER_ACCESS_TOKEN_SECRET=<minimaal 32 tekens>
ADMIN_PASSWORD=<minimaal 16 tekens>
ADMIN_SESSION_SECRET=<minimaal 32 tekens>
VITE_AUTH_ENABLED=false
VITE_NO_INDEX=1
NO_INDEX=1
VITE_PUBLIC_HOSTNAME=afslank-injecties.nl
```

`DATABASE_URL` en `MIGRATION_DATABASE_URL` moeten naar dezelfde Neon-branch en
database wijzen. De migratie-URL moet direct/unpooled zijn en expliciete
credentials bevatten. Configureer in deze wachtwoord-adminopzet geen
`ADMIN_EMAILS`.

`VITE_NO_INDEX` wordt tijdens de build in de HTML verwerkt. `NO_INDEX` wordt
tijdens runtime gebruikt voor `X-Robots-Tag`. Beide blijven `1` zolang de site
niet geïndexeerd mag worden.

## Build en controle

```bash
npm ci --include=dev
npm run build:hostinger
test -f .output/server/index.mjs
npm start
```

De build voert na `vite build` automatisch `npm run db:migrate` uit. Een
migratiefout of ontbrekende databaseconfiguratie stopt de deployment.

## Bestaand domein veilig omzetten

`afslank-injecties.nl` bestaat al als Hostinger-website en bevat ook de
mailconfiguratie. Verwijder of hermaak deze website daarom niet in hPanel. De
gekozen deployroute uploadt een bronarchief naar de bestaande website via
Hostingers `nodejs/builds/from-archive`-API. Zo blijven domein, DNS en mailbox
bestaan. Maak vóór iedere andere conversieroute eerst een volledige
website-/mailbackup en controleer daarna opnieuw de mailbox en DNS-records.

Controleer na deployment minimaal homepage, productpagina, checkout,
gastbestelling, wachtwoord-admin en contact. Controleer daarnaast op iedere
representatieve route beide noindex-lagen:

```bash
curl -sSI https://afslank-injecties.nl/ | grep -i '^x-robots-tag:'
curl -s https://afslank-injecties.nl/ | grep -i 'name="robots"'
```

De verwachte waarde is `noindex, nofollow, noarchive`. Controleer hetzelfde
voor een echte `/product/...`-pagina, `/checkout` en `/admin`. Test daarnaast
het contactformulier vanaf de homepage. Bekijk ten slotte de Hostinger
runtime-logs op 500-fouten. Merge deze branch niet naar `main` voordat de
volledige live proef groen is.

## Mailacceptatie

De app verzendt zelf nog geen automatische e-mail. Controleer de bestaande
mailbox `info@afslank-injecties.nl` daarom los van de app:

1. verstuur via Hostinger SMTP een testbericht naar de ingestelde testontvanger;
2. verstuur ook een testbericht naar de mailbox zelf en bevestig de ontvangst
   via Hostinger IMAP;
3. controleer dat MX, SPF, DKIM en DMARC voor het domein aanwezig blijven;
4. controleer na de Node-deploy opnieuw dat aanmelden en verzenden werken.
