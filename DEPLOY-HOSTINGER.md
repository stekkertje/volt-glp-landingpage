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
DATABASE_URL=<Neon direct/unpooled URL>
MIGRATION_DATABASE_URL=<Neon direct/unpooled URL>
BETTER_AUTH_SECRET=<minimaal 32 tekens>
ORDER_ACCESS_TOKEN_SECRET=<minimaal 32 tekens>
ADMIN_PASSWORD_BASE64=<base64/base64url van het bestaande wachtwoord>
ADMIN_SESSION_SECRET=<minimaal 32 tekens>
VITE_AUTH_ENABLED=false
VITE_NO_INDEX=1
NO_INDEX=1
VITE_PUBLIC_HOSTNAME=afslank-injecties.nl
TRUST_HOSTINGER_PROXY=1
```

`DATABASE_URL` en `MIGRATION_DATABASE_URL` moeten naar dezelfde Neon-branch en
database wijzen. Gebruik voor deze Hostinger-runtime bij beide variabelen de
directe/unpooled Neon-URL. De app pint `search_path=public` bij het openen van de
verbinding; Neons transaction-pooler accepteert die startupoptie niet. De
langlopende Hostinger Node-server kan de directe verbinding gebruiken. De
migratie-URL moet daarnaast expliciete credentials bevatten. Configureer in
deze wachtwoord-adminopzet geen `ADMIN_EMAILS`.

Gebruik op Hostinger `ADMIN_PASSWORD_BASE64` en laat `ADMIN_PASSWORD` leeg of
weg. De app decodeert de waarde strikt naar UTF-8; het wachtwoord dat je op
`/admin` invoert blijft exact hetzelfde. Base64 en base64url (met correcte of
zonder padding) worden ondersteund. Ongeldige codering, controltekens of beide
wachtwoordvariabelen tegelijk laten de adminconfiguratie fail-closed mislukken.
Het gedecodeerde wachtwoord blijft in productie minimaal 16 tekens.

`VITE_NO_INDEX` wordt tijdens de build in de HTML verwerkt. `NO_INDEX` wordt
tijdens runtime gebruikt voor `X-Robots-Tag`. Beide blijven `1` zolang de site
niet geïndexeerd mag worden.

`TRUST_HOSTINGER_PROXY=1` staat alleen op deze Hostinger-runtime. Daarmee wordt
`https://afslank-injecties.nl` de vaste publieke origin voor mutaties en HSTS,
ook wanneer de interne Node-request na TLS-terminatie `http` gebruikt. De app
leidt deze beveiligingsbeslissing niet af uit publiek aanleverbare forwarded
host/protocolheaders. Voor bezoekersgebonden rate limits gebruikt de app alleen
een enkel geldig `X-Real-IP`; `X-Forwarded-For` blijft buiten gebruik. Controleer
na de live deploy in Hostinger dat de managed proxy `X-Real-IP` werkelijk
overschrijft. Zet de trustflag niet op een andere of direct publiek bereikbare
Node-runtime.

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
