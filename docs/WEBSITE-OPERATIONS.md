# Websitebeheer · afslank-injecties.nl

Dit document bevat de duurzame operationele context voor toekomstige beheertaken. Geheime waarden horen uitsluitend in lokale secretbestanden en nooit in deze repository.

## Identiteit en systemen

| Onderdeel         | Huidige bron of dienst                                  |
| ----------------- | ------------------------------------------------------- |
| Repository        | `stekkertje/volt-glp-landingpage`                       |
| Lokale projectmap | `/Users/mpp/Documents/ChatGPT/volt-glp-landingpage-pr2` |
| Publiek domein    | `https://afslank-injecties.nl`                          |
| Hosting           | Hostinger Cloud, Node.js 22                             |
| Database          | Neon PostgreSQL                                         |
| Mailbox           | `info@afslank-injecties.nl` via Hostinger               |
| Standaard build   | Vercel-preset via `npm run build`                       |
| Hostinger build   | Nitro `node-server` via `npm run build:hostinger`       |
| Productiestart    | `npm start` → `.output/server/index.mjs`                |
| Indexering        | Uitgeschakeld totdat de eigenaar dit expliciet wijzigt  |

Cloudflare is niet actief in de huidige deploymentarchitectuur. Voeg het niet stilzwijgend toe.

## Bronnen van waarheid

- Producten, varianten, prijzen en productcopy: `src/lib/product.ts`.
- Serverprijsberekening: `src/lib/server/pricing.ts`.
- Databasevorm: `migrations/` en server-datalaag.
- Hostingerconfiguratie en live acceptatie: `DEPLOY-HOSTINGER.md`.
- Design, UX en bestaande productkeuzes: `GROK.md`.
- Prijswijzigingsregels: `AGENTS.project.md`.
- Uitvoerbare scripts en vereiste versies: `package.json` en de betreffende scripts.
- Duurzame technische beslissingen: `docs/DECISIONS.md`.

Controleer feiten in code of het externe systeem wanneer ze recent veranderd kunnen zijn. Documentatie alleen is geen bewijs van actuele live status.

## Functionele status

- De winkelwagen draait in de browser; checkout valideert en herberekent server-side.
- Gast- en accountcheckout schrijven echte bestellingen naar PostgreSQL en vragen altijd een actueel bezorgadres.
- Contactberichten worden opgeslagen en transactionele contact-, account- en bestelmail loopt via een duurzame outbox.
- Klantaccounts ondersteunen verificatie, wachtwoordherstel, bestelgeschiedenis en een eenmalige e-mailclaim voor eerdere gastorders.
- Gasttoegang tot de zojuist geplaatste bestelling gebruikt uitsluitend een tijdelijke HttpOnly-cookie; de handmatige herstelcode is verwijderd.
- Adressen worden server-side gecontroleerd via ApiCheck voor Nederland en Google Address Validation voor overige ondersteunde EU-landen.
- Admin ondersteunt Better Auth-allowlisting en/of de geconfigureerde wachtwoordroute, ordermutaties en MyParcel-concepten, A6-labels en tracking.
- Betaling blijft handmatig. Er is nog geen automatische betaalprovider, voorraadadministratie of refundflow.

## Autorisatiegrenzen

De centrale bevoegdheidsregel staat één keer volledig in `AGENTS.override.md` en
geldt voor alle onderhoudsflows. Samengevat: bevestigde interne,
niet-zichtbare en niet-hinderlijke handelingen mogen autonoom worden onderzocht,
gewijzigd, getest, gereviewd, gepubliceerd naar `hostinger-node-server`, via de
bestaande Hostinger-route gedeployd en live gecontroleerd. Werk nooit
rechtstreeks op `main`.

Alleen de vier uitzonderingen uit die centrale regel vereisen vlak vóór
publicatie of uitvoering een expliciet `ja`: zichtbare of mogelijk hinderlijke
impact; product-, prijs-, medische, juridische, bestel-, betaal-, verzend- of
beheerwijzigingen; onomkeerbare productiedata, kosten, credential- of
toegangsuitbreiding of een ontbrekende zakelijke keuze; en materiële
scope-uitbreiding buiten deze webshop. Gewone tool-, shell-, netwerk-, sandbox-
en testacties zijn geen inhoudelijk toestemmingsmoment.

## Lokale secrets

De beveiligde bestanden staan in `/Users/mpp/Desktop/Codex-koppelingen`.

- `hostinger-token.env`: Hostinger API-toegang.
- `cloudflare-token.env`: alleen gebruiken als Cloudflare expliciet in scope komt.
- `afslank-injecties-deploy.env`: projectgebonden Neon-, admin- en mailconfiguratie.

Lees nooit een volledig secretbestand naar terminaloutput. Parse alleen allowlisted variabelen in het proces dat ze nodig heeft. Controleer externe toegang eerst read-only.

## Git- en releasecontext

De repository kan open branches en pull requests bevatten. Beschouw branch- en CI-status als veranderlijke informatie en controleer die bij aanvang. Een geannuleerde, overgeslagen of ontbrekende vereiste check is niet groen.

Gebruik bij vervolgwerk aan een bestaande PR dezelfde branch wanneer dat logisch en expliciet gewenst is. Gebruik voor losstaand werk een aparte branch. Merge naar `main` blijft een afzonderlijke beslissing van de eigenaar.

## GitHub-automatisering

De deterministische CI-, CodeQL-, dependency-review- en Dependabotcontroles
draaien volledig op GitHub Actions en vragen geen lokale Codex-goedkeuringen.
De Codex-review en geplande Codex-onderhoudsrun worden uitsluitend uitgevoerd
wanneer repositoryvariabele `CODEX_AUTOMATION_ENABLED` exact `true` is en het
repositorysecret `OPENAI_API_KEY` bestaat. Houd de variabele op `false` zolang
die sleutel ontbreekt; zo worden AI-jobs netjes overgeslagen in plaats van rood
te falen. De geheime waarde hoort uitsluitend in GitHub Actions secrets en
nooit in Git, documentatie of logs.

## Onderhoud van dit document

Werk dit bestand bij wanneer hosting, database, domein, mailbox, repositorypad, functionele status of autorisatiegrenzen duurzaam veranderen. Zet hier nooit tijdelijke runstatus, wachtwoorden of tokenwaarden in.
