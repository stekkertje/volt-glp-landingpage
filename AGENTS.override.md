# Codex-instructies voor afslank-injecties.nl

## Rol en scope

- Beheer uitsluitend de bestaande webshop van Afslank-injecties.nl in deze repository en het domein `afslank-injecties.nl`.
- Werk voort op de bestaande applicatie. Scaffold of herschrijf de app niet zonder een expliciete opdracht.
- Antwoord de gebruiker in het Nederlands. Houd UI-copy volledig Nederlands en gebruik geen em-dash (`—`).
- Behandel een verzoek om te beoordelen of uit te leggen als read-only. Wijzig, commit, push, merge of deploy alleen wanneer het verzoek dat omvat.
- Maak redelijke, omkeerbare aannames bij kleine onduidelijkheden. Vraag alleen om richting wanneer een keuze de functionaliteit, kosten, juridische positie of productie wezenlijk verandert.

## Verplichte oriëntatie

Lees vóór inhoudelijk werk:

1. `README.md` voor stack, backend en actuele productcontext.
2. `docs/WEBSITE-OPERATIONS.md` voor systemen, bronnen van waarheid en autorisatiegrenzen.
3. Alleen de relevante verdieping:
   - `GROK.md` voor product-, ontwerp-, copy- en UX-regels;
   - `AGENTS.project.md` voor prijs- of kortingswijzigingen;
   - `DEPLOY-HOSTINGER.md` vóór Hostinger-, Neon-, mail- of productiewerk;
   - `docs/REVIEW-CHECKLIST.md` bij implementatie, review, bugfix of deploy;
   - `docs/DECISIONS.md` bij architectuur-, security-, data- of hostingkeuzes.

Controleer vóór wijzigingen `git status --short --branch`, de actieve branch en relevante pull request. Bestaande wijzigingen zijn van de gebruiker en mogen niet worden overschreven.

## Niet-onderhandelbare productregels

- `src/lib/product.ts` is de bron van waarheid voor producten, prijzen, opties, badges en cataloguscopy.
- Checkout berekent prijzen op de server. Vertrouw nooit prijswaarden uit de browser.
- Historische orderregels blijven onveranderlijke snapshots. Een cataloguswijziging mag bestaande orders niet herschrijven.
- Productie gebruikt PostgreSQL via Neon. PGLite is uitsluitend voor lokale development en tests.
- Hostinger Cloud Node.js 22 is het actieve hostingpad. Cloudflare valt buiten scope tenzij de gebruiker het expliciet toevoegt.
- De site blijft `noindex, nofollow, noarchive` in HTML en `X-Robots-Tag` totdat de gebruiker expliciet toestemming geeft om indexering aan te zetten.
- Betaling, voorraadbeheer en refunds zijn niet geïmplementeerd. Transactionele e-mail, adrescontrole en MyParcel zijn wel onderdeel van de applicatie, maar presenteer ze pas als live werkend na een groene deploy- en praktijkcontrole.
- Voeg geen nieuwe medische werkzaamheids-, veiligheids- of geschiktheidsclaims toe zonder expliciete, verifieerbare bron en opdracht. Signaleer misleidende of intern tegenstrijdige claims.

## Centrale bevoegdheidsregel voor onderhoud

De eigenaar geeft voor onderhoud aan deze webshop vooraf volledige inhoudelijke
toestemming voor bevestigde interne, niet-zichtbare en niet-hinderlijke
handelingen. Dit omvat lezen en bewerken, commando's, tests, builds en
netwerksmokes, branches, commits, pushes en PR's, veilige CI- en
securityconfiguratie en, na groene verificatie, merge naar
`hostinger-node-server`, deploy via de bestaande Hostinger-route en live
controle. Vraag hiervoor geen extra bevestiging.

Vraag uitsluitend vlak vóór publicatie of uitvoering om een expliciet `ja`
wanneer ten minste één van deze uitzonderingen echt geldt:

1. een klant of de eigenaar kan de wijziging zichtbaar of merkbaar zien of
   mogelijk hinder ervaren;
2. prijs, productaanbod of productinhoud, medische of juridische tekst,
   bestel-, betaal- of verzendbeleid of beheerworkflow verandert;
3. een onomkeerbare productie-datamutatie, betaalde aankoop of abonnement,
   credential- of toegangsuitbreiding of ontbrekende zakelijke keuze nodig is;
4. de handeling de scope materieel uitbreidt buiten het onderhoud van deze
   webshop.

Een gewone tool-, shell-, netwerk-, sandbox- of testactie is geen inhoudelijk
toestemmingsmoment. Een door het platform afgedwongen technische
goedkeuringsdialoog blijft beperkt tot dat technisch noodzakelijke moment en
wordt niet als tweede vraag in de chat herhaald.

## Secrets en externe systemen

- Zet nooit tokens, wachtwoorden, database-URL's, mailboxinhoud of andere geheimen in chat, patches, Git, plannen of logs.
- Lokale toegangsbestanden staan buiten de repository in `/Users/mpp/Desktop/Codex-koppelingen`. Lees alleen de minimale benodigde variabelen en toon nooit hun waarden.
- Gebruik voor Hostinger- en Cloudflare-toegang respectievelijk `hostinger-token.env` en `cloudflare-token.env`. Controleer toegang eerst met een niet-wijzigend API-verzoek.
- Gebruik `afslank-injecties-deploy.env` uitsluitend wanneer de gebruiker een Neon-, Hostinger- of mailhandeling binnen dit project heeft opgedragen.
- Tests mogen nooit de productiedatabase, productieorders of echte klantgegevens wijzigen. Gebruik een geïsoleerde testdatabase of fixtures.
- Pas voor productiehandelingen de centrale bevoegdheidsregel en de vier
  uitzonderingen hierboven toe.

## Wijzigingsworkflow

1. Bepaal de kleinste relevante scope en inspecteer de huidige implementatie en tests.
2. Reproduceer een bug waar praktisch mogelijk voordat je hem oplost.
3. Maak een gerichte wijziging; voeg geen ongevraagde features of brede refactors toe.
4. Voeg of pas regressiedekking aan wanneer gedrag, checkout, prijzen, authenticatie, database, navigatie of deployment verandert.
5. Volg de risicogestuurde controles in `docs/REVIEW-CHECKLIST.md`.
6. Beoordeel de uiteindelijke diff op regressies, secrets, onbedoelde scope en documentatie-afwijkingen.
7. Werk `docs/DECISIONS.md` alleen bij wanneer een duurzame architectuur-, security-, data- of hostingbeslissing verandert.
8. Rapporteer concreet wat is veranderd, welke controles groen zijn en wat niet is uitgevoerd.

## GitHub en review

- Werk niet rechtstreeks op `main`. Gebruik de bestaande featurebranch wanneer de opdracht bij de open PR hoort; maak anders een passend benoemde branch wanneer Git-publicatie is gevraagd.
- Volg voor commit, push en PR-publicatie de centrale bevoegdheidsregel.
- Merge nooit naar `main` zonder expliciete toestemming in de huidige conversatie.
- Behandel CI niet als groen wanneer een vereiste check ontbreekt, is overgeslagen, geannuleerd of nog loopt.
- Reviews prioriteren functionele fouten, dataintegriteit, checkout/pricing, auth, secrets, privacy, toegankelijkheid, mobiele UX en deployrisico. Meld geen ruis die alleen persoonlijke stijl betreft.
- Verifieer iedere reviewbevinding tegen de actuele code voordat je een fix toepast. Test de fix opnieuw.

## Autonoom onderhoud en meldingen

- Pas de centrale bevoegdheidsregel toe en werk nooit rechtstreeks op `main`.
- Een rode test of AI-bevinding is nooit voldoende bewijs. Reproduceer het
  probleem, valideer de fix, laat risicovolle checkout-, auth-, database-,
  secret- en deploywijzigingen onafhankelijk beoordelen en publiceer alleen
  wanneer de vereiste controles groen zijn.
- Maak voor automatisch onderhoud een aparte fixbranch en controleerbare PR.
  Laat geen agent rechtstreeks ongecontroleerde wijzigingen naar productie
  schrijven en omzeil geen vereiste checks.

## Deploy en live controle

- Lees `DEPLOY-HOSTINGER.md` volledig vóór iedere deploy.
- Verwijder of hermaak de bestaande Hostinger-website niet; domein, DNS en mailbox moeten behouden blijven.
- Start geen tweede deploy zolang een eerdere upload of build nog loopt.
- Controleer na een gevraagde deploy minimaal homepage, een productpagina, checkout, admin/login, contact, relevante headers, noindex, runtimefouten en de expliciet gewijzigde flow.
- Test mail alleen wanneer dat is opgedragen. Verstuur uitsluitend naar de ingestelde testontvanger en meld dat er een echte testmail wordt verzonden.
- Leg een live resultaat niet als geslaagd vast zonder observeerbaar bewijs.

## Afronding

- Laat de werkboom niet per ongeluk vervuild achter met screenshots, logs, downloads, databasebestanden of tijdelijke secrets.
- Verwijder geen bestaand gebruikerswerk. Maak tijdelijke artefacten herstelbaar wanneer opruimen nodig is.
- Noem altijd resterende risico's, niet-uitgevoerde controles en eventuele vereiste menselijke beslissingen.
