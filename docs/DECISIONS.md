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
