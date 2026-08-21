## Automatisch voorbereid onderhoud

Deze concept-PR is door de begrensde Codex-onderhoudsflow voorbereid.

- Doelbranch: `hostinger-node-server`
- Productiegegevens en klantdata zijn niet gebruikt
- Productiecode, configuratie, producten, prijzen en migraties zijn door een positieve testbestanden-allowlist uitgesloten
- Tests, typecheck, lint en een build zonder productiemigraties waren groen vóór publicatie
- Een afzonderlijke read-only Codex-run heeft de patch zonder P0-P3 goedgekeurd

De PR blijft concept voor controleerbaarheid. Zichtbare of mogelijk hinderlijke
wijzigingen mogen pas na een expliciet `ja` van de eigenaar worden gepubliceerd
of gedeployd.
