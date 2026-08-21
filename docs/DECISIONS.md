# Duurzame projectbeslissingen

Dit logboek bevat alleen keuzes die toekomstig beheer sturen. Tijdelijke uitvoeringsstatus en geheimen horen hier niet in.

## 2026-08-19 · Hostinger Cloud met Neon

- Hostinger Cloud Node.js 22 is het actieve productiepad voor `afslank-injecties.nl`.
- Neon PostgreSQL is de externe productiedatabase; Hostinger MySQL is niet compatibel met de applicatie.
- De Hostinger-build gebruikt Nitro `node-server` via `npm run build:hostinger` en start `.output/server/index.mjs` via `npm start`.
- De bestaande Hostinger-website wordt bijgewerkt, niet verwijderd of opnieuw aangemaakt, zodat domein, DNS en mailbox behouden blijven.
- Vercel blijft als standaard buildpreset in de code beschikbaar.
- Cloudflare is niet opgenomen; toevoeging vereist een afzonderlijke expliciete beslissing.

## 2026-08-19 · Zoekmachine-indexering

- De omgeving blijft `noindex, nofollow, noarchive` via zowel HTML-meta als `X-Robots-Tag`.
- Indexering wordt alleen aangezet na expliciete toestemming van de eigenaar en een aparte controle van content, juridische/commerciële gereedheid en live routes.

## 2026-08-19 · Database- en migratieveiligheid

- Productie vereist expliciete PostgreSQL-URL's; de applicatie valt daar niet stil terug op PGLite.
- Runtime en migrator wijzen naar dezelfde Neon-branch en database.
- De migrator gebruikt een directe/unpooled verbinding, een session advisory lock en begrensde lock-wachttijd.
- Historische orderregels worden niet aangepast door catalogus- of prijswijzigingen.

## 2026-08-19 · Bestel- en adminmodel

- Checkout ondersteunt gastbestellingen en berekent prijzen server-side.
- Betaling en e-mailafhandeling blijven handmatig totdat een afzonderlijk project ze implementeert en test.
- Gasttoegang gebruikt tijdelijke, beschermde toegang; ordergeheimen moeten stabiel en roteerbaar blijven.
- Admin kan via Better Auth-allowlist en/of een afzonderlijke wachtwoordroute werken. Secrets blijven server-side en buiten Git.

## 2026-08-19 · Permanente AI-beheerlaag

- Grok-sandboxinstructies blijven in `AGENTS.md` en `GROK.md` behouden.
- Codex gebruikt `AGENTS.override.md` als repositoryspecifieke hoofdinstructie.
- Operationele context, reviewregels en duurzame beslissingen staan in `docs/` zodat toekomstige chats niet uitsluitend van conversatiegeheugen afhangen.
- De persoonlijke Codex-skill `afslank-injecties-websitebeheer` routeert toekomstige verzoeken voor dit domein naar deze repository en instructies.
- De centrale onderhoudsbevoegdheid en de vier uitzonderingen staan uitsluitend
  volledig in `AGENTS.override.md`; operationele documentatie verwijst daarnaar
  om dubbele of tegenstrijdige toestemmingsvragen te voorkomen.
- Automatisch onderhoud werkt altijd via een aparte fixbranch en
  controleerbare PR, nooit rechtstreeks op `main` en nooit door vereiste checks
  te omzeilen.

## 2026-08-20 · Klantaccounts en gastorderkoppeling

- Klantaccounts gebruiken Better Auth met e-mailverificatie, wachtwoordherstel en een eigen bestelgeschiedenis.
- Productie gebruikt standaard e-mail/wachtwoord. Google/X OAuth is alleen
  actief na een expliciete publieke flag én volledige eigen clientconfiguratie;
  ontbrekende productiecredentials falen gesloten. De ingebouwde brokerclient
  blijft beperkt tot niet-productiepreviewhosts.
- Checkout blijft voor iedere bestelling een volledig actueel bezorgadres vragen, ook wanneer de klant is ingelogd.
- De handmatige tijdelijke herstelcode is verwijderd. Iedere zojuist geplaatste
  gastorder blijft 72 uur onafhankelijk bereikbaar via een eigen host-only
  HttpOnly-cookie, zodat een volgende gastbestelling eerdere toegang niet
  overschrijft.
- Eerdere gastorders worden uitsluitend na een eenmalige, kort geldige bevestigingslink naar het e-mailadres van het ingelogde account gekoppeld.

## 2026-08-20 · Transactionele e-mail

- Contact-, account-, bestel- en relevante orderwijzigingsmails worden atomair in een PostgreSQL-outbox gezet en via Hostinger SMTP afgeleverd.
- Bevestigde of mogelijk al geaccepteerde SMTP-delivery wordt nooit automatisch opnieuw verzonden. Onzekere afleveringen worden terminal gemarkeerd voor handmatige controle in beheer.
- Productie start met `REQUIRE_MAIL=1` niet wanneer de vereiste SMTP-configuratie ontbreekt.

## 2026-08-20 · Adrescontrole en MyParcel

- Nederlandse adressen worden server-side gecontroleerd via ApiCheck; overige ondersteunde EU-adressen via Google Address Validation.
- Een voorgesteld gecorrigeerd adres wordt nooit stil toegepast en vereist expliciete bevestiging van de klant of beheerder.
- MyParcel-conceptaanmaak is idempotent en reconcilieert onzekere providerresponses voordat een nieuwe create-call mogelijk is.
- Conceptaanmaak, A6-labelaanvraag en trackingrefresh zijn afzonderlijke beheeracties. Een label wordt niet automatisch tijdens checkout aangemaakt.
- Fulfillmentregels zijn los van de onveranderlijke betaalde orderregels; historische producten en bedragen blijven de bron voor wat de klant heeft betaald.
