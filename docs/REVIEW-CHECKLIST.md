# Review- en verificatiechecklist

Gebruik alleen de onderdelen die passen bij de wijziging, maar sla een relevant risico niet over. Bewaar productiegegevens buiten tests.

## Iedere codewijziging

- Controleer `git diff` op onbedoelde bestanden, debugcode, secrets en scope creep.
- Voer `npm run typecheck` en `npm run lint` uit.
- Draai de kleinste relevante regressietests. Breid tests uit wanneer gedrag verandert.
- Controleer foutpaden, lege states, loading states en dubbele verzending waar relevant.
- Gebruik een build die geen productiemigraties raakt. Gebruik alleen een echte productiebuild met expliciet geautoriseerde, veilige databaseconfiguratie.

Documentatie-only wijzigingen vereisen geen applicatiebuild; controleer dan links, paden, commando's en tegenstrijdigheden.

## UI, copy en navigatie

- Controleer minimaal desktop en mobiel rond 390–402 CSS-pixels.
- Controleer primaire CTA, toetsenbordbediening, focus, labels, contrast en layoutverschuivingen.
- Controleer sticky header, mobiele koopbalk, cookie-/modaloverlap en winkelwagendrawer indien geraakt.
- Houd UI-copy Nederlands, zonder em-dash en zonder onbevestigde medische claims.
- Vergelijk visueel met de bestaande lichte, koele VOLT-stijl; introduceer geen dark theme of beige herontwerp.

## Product, prijs, korting en checkout

- Volg `AGENTS.project.md` volledig.
- Controleer kaart, productpagina, iedere optie, winkelwagen, checkoutpreview en serverorderbedrag.
- Controleer integer eurocenten, compare-at, badges, weekdeal, stapelkorting, `VOLT10`, verzending en historische orders.
- Test manipulatie van clientprijzen, stale carts, dubbel indienen/idempotency en afronding.

## Backend, database en authenticatie

- Voeg voor schemawijzigingen een voorwaartse, idempotent geteste migratie toe; herschrijf geen toegepaste migratie.
- Test tegen een geïsoleerde PostgreSQL-database wanneer PostgreSQL-gedrag relevant is.
- Controleer autorisatie aan de serverzijde, sessiecookies, CSRF/originbeleid, rate limits en foutresponsen.
- Controleer dat logs en responses geen secrets, herstelcodes, wachtwoorden of klantdata lekken.
- Verifieer dat runtime- en migratie-URL dezelfde Neon-branch/database gebruiken zonder de URL te tonen.

## GitHub en onafhankelijke review

- Controleer de volledige branchdiff tegen de juiste basebranch.
- Bevestig dat vereiste CI-checks werkelijk succesvol zijn; `cancelled`, `skipped`, `pending` en ontbrekend zijn niet groen.
- Laat bij risicovolle checkout-, auth-, database-, secret- of deploywijzigingen een onafhankelijke review uitvoeren wanneer beschikbaar en door de opdracht toegestaan.
- Valideer reviewbevindingen zelf, pas alleen bevestigde fixes toe en herhaal de geraakte tests.

## Hostinger-deploy

- Lees `DEPLOY-HOSTINGER.md` volledig.
- Controleer vooraf read-only de doelwebsite, huidige deployment en benodigde toegang.
- Behoud domein, DNS en mailbox; verwijder of hermaak de bestaande website niet.
- Laat maximaal één upload/build tegelijk lopen.
- Controleer na deploy homepage, product, checkout, admin/login, contact en de gewijzigde flow.
- Controleer statuscodes, runtimefouten, HSTS en beide noindexlagen.
- Controleer mail/DNS alleen voor zover de opdracht dit vereist; stuur geen echte mail zonder expliciete toestemming.
- Noteer het gedeployde commit-id en observeerbaar acceptatiebewijs in de PR of eindrapportage wanneer GitHub-publicatie onderdeel van de opdracht is.

## Afronding

- Benoem uitgevoerde tests met resultaat.
- Benoem expliciet wat niet is getest of gedeployd.
- Meld resterende risico's en noodzakelijke menselijke beslissingen.
- Laat geen tijdelijke archieven, screenshots, logs, databases of secrets in Git achter.
