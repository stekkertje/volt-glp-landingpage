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
REQUIRE_MAIL=1
DATABASE_URL=<Neon direct/unpooled URL>
MIGRATION_DATABASE_URL=<Neon direct/unpooled URL>
BETTER_AUTH_SECRET=<minimaal 32 tekens>
BETTER_AUTH_URL=https://afslank-injecties.nl
ORDER_ACCESS_TOKEN_SECRET=<minimaal 32 tekens>
ADMIN_PASSWORD_BASE64=<base64/base64url van het bestaande wachtwoord>
ADMIN_SESSION_SECRET=<minimaal 32 tekens>
VITE_AUTH_ENABLED=true
VITE_OAUTH_ENABLED=false
VITE_NO_INDEX=1
NO_INDEX=1
VITE_PUBLIC_HOSTNAME=afslank-injecties.nl
TRUST_HOSTINGER_PROXY=1
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USERNAME=<Hostinger-mailbox>
SMTP_PASSWORD_BASE64=<base64/base64url van het exacte Hostinger-mailboxwachtwoord>
MAIL_FROM_ADDRESS=info@afslank-injecties.nl
MAIL_FROM_NAME=Afslank Injecties
MAIL_OWNER_ADDRESS=info@afslank-injecties.nl
REQUIRE_ADDRESS_VALIDATION=1
APICHECK_API_KEY=<server-only sleutel>
GOOGLE_ADDRESS_VALIDATION_API_KEY=<server-only sleutel>
MYPARCEL_API_KEY=<ruwe server-only sleutel; de app maakt zelf Basic base64-auth>
```

`DATABASE_URL` en `MIGRATION_DATABASE_URL` moeten naar dezelfde Neon-branch en
database wijzen. Gebruik voor deze Hostinger-runtime bij beide variabelen de
directe/unpooled Neon-URL. De app pint `search_path=public` bij het openen van de
verbinding; Neons transaction-pooler accepteert die startupoptie niet. De
langlopende Hostinger Node-server kan de directe verbinding gebruiken. De
migratie-URL moet daarnaast expliciete credentials bevatten. Configureer in
deze wachtwoord-adminopzet geen `ADMIN_EMAILS`. Klantaccounts gebruiken
e-mail/wachtwoord via Better Auth. De wachtwoord-admin blijft daarvan
gescheiden.

Google/X OAuth staat voor deze Hostinger-opzet standaard uit met
`VITE_OAUTH_ENABLED=false`; de shop gebruikt e-mail/wachtwoord. Zet OAuth alleen
bewust op `true` wanneer voor `https://afslank-injecties.nl` een eigen broker-
client bestaat en voeg dan beide server-only secrets
`GROK_AUTH_CLIENT_ID` en `GROK_AUTH_CLIENT_SECRET` toe. Een productiebuild met
OAuth aan en een ontbrekende credential stopt fail-closed. De ingebouwde
previewclient is uitsluitend geldig voor Grok-previewhosts en wordt nooit als
productiefallback gebruikt.

Gebruik op Hostinger `ADMIN_PASSWORD_BASE64` en laat `ADMIN_PASSWORD` leeg of
weg. De app decodeert de waarde strikt naar UTF-8; het wachtwoord dat je op
`/admin` invoert blijft exact hetzelfde. Base64 en base64url (met correcte of
zonder padding) worden ondersteund. Ongeldige codering, controltekens of beide
wachtwoordvariabelen tegelijk laten de adminconfiguratie fail-closed mislukken.
Het gedecodeerde wachtwoord blijft in productie minimaal 16 tekens.

Gebruik voor SMTP op Hostinger bij voorkeur `SMTP_PASSWORD_BASE64` en laat
`SMTP_PASSWORD` daarna weg. Base64 en base64url, met correcte of zonder padding,
worden strikt naar UTF-8 gedecodeerd; een niet-lege ongeldige waarde,
controltekens en niet-canonieke codering stoppen de mailconfiguratie zonder het
geheim te tonen. Een lege waarde geldt als niet ingesteld.
`SMTP_PASSWORD` en `MAILBOX_PASSWORD` blijven als raw compatibiliteitsfallback
bestaan. Tijdens een veilige overgang mag de oude raw variabele tijdelijk naast
`SMTP_PASSWORD_BASE64` blijven staan; de encoded waarde heeft dan bewust
voorrang, ook wanneer Hostinger de raw speciale tekens heeft veranderd. Verwijder
de raw variabele zodra de SMTP-controle met de encoded waarde groen is.

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
Met `REQUIRE_MAIL=1` weigert de Node-runtime daarnaast te starten wanneer de
SMTP-gebruikersnaam of het SMTP-wachtwoord ontbreekt. Zo kan een deployment
niet ongemerkt zonder transactionele e-mail online komen.

## Bestaand domein veilig omzetten

`afslank-injecties.nl` bestaat al als Hostinger-website en bevat ook de
mailconfiguratie. Verwijder of hermaak deze website daarom niet in hPanel. De
gekozen deployroute uploadt een bronarchief naar de bestaande website via
Hostingers `nodejs/builds/from-archive`-API. Zo blijven domein, DNS en mailbox
bestaan. Maak vóór iedere andere conversieroute eerst een volledige
website-/mailbackup en controleer daarna opnieuw de mailbox en DNS-records.

Controleer na deployment minimaal homepage, productpagina, checkout,
gastbestelling, registratie, e-mailbevestiging, inloggen, wachtwoordherstel,
accountbestellingen, wachtwoord-admin en contact. Controleer daarnaast op iedere
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

De app levert contact-, account- en bestelmail via een duurzame database-outbox
en Hostinger SMTP. Test uitsluitend met de ingestelde testontvanger en de eigen
mailbox `info@afslank-injecties.nl`:

1. verstuur een contactbericht en bevestig zowel de eigenaarsmail als de
   klantbevestiging met de belofte van 48 uur op werkdagen;
2. registreer een testaccount en controleer e-mailbevestiging,
   wachtwoordherstel en inloggen;
3. plaats één duidelijk gemarkeerde testbestelling en bevestig dat zowel klant
   als eigenaar exact één bestelbevestiging ontvangt;
4. wijzig in beheer achtereenvolgens status, bezorgadres en
   fulfillmentproducten en controleer de bijbehorende klantmails;
5. bevestig via IMAP dat de berichten aankomen en controleer dat MX, SPF, DKIM
   en DMARC voor het domein aanwezig blijven;
6. controleer de outbox op blijvend `pending` of `failed` en controleer de
   Hostinger-logs zonder mailinhoud of adressen te loggen.

## Adrescontrole en MyParcel

- Nederland wordt server-side gecontroleerd via ApiCheck; overige ondersteunde
  EU-adressen via Google Address Validation. De klant moet ook ingelogd altijd
  zelf een actueel bezorgadres invullen en een voorgestelde correctie bevestigen.
- MyParcel gebruikt uitsluitend de server-only API-sleutel. Maak een zending
  idempotent op basis van het bestelnummer en reconcilieer een onzekere response
  vóór een nieuwe create-call.
- Conceptzending en labelaanvraag zijn aparte beheeracties. Voor de live proef
  mag uitsluitend voor de duidelijk gemarkeerde testbestelling een testlabel
  worden aangemaakt. Scan of overhandig dat label niet.
- Controleer dat barcode, trackinglink en trackingstatus bij de juiste order in
  beheer en in het klantaccount verschijnen.
