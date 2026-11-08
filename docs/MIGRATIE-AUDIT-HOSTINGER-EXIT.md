# Audit en gecorrigeerd migratieplan: weg bij Hostinger

Status: audit uitgevoerd, migratie **niet** uitgevoerd.
Datum van de controles: 8 november 2026, rond 10:06 uur (Europe/Amsterdam).
Scope van deze audit: het aangeleverde OpenCart-migratieplan, de live shop op
`afslank-injecties.nl` (alleen read-only controles vanaf internet) en deze
repository. Er is niets gekocht, geen DNS gewijzigd, geen server ingericht en
geen productiehandeling gedaan.

Een daadwerkelijke verhuizing is zichtbaar en merkbaar voor klanten en valt
daarom onder de autorisatiegrens in `AGENTS.override.md`: pas uitvoeren na een
korte impactsamenvatting en een expliciet `ja` van de eigenaar.

## 1. Conclusie in het kort

Het aangeleverde plan is **niet uitvoerbaar zoals het er staat**. De richting
(Cloudflare ervoor, eigen VPS erachter, origin afschermen) klopt in grote
lijnen, maar het plan bevat concrete technische fouten waardoor SEO-URL's
breken, Nginx niet herlaadt of Cloudflare-verkeer juist wordt geweigerd.
Daarnaast mist het plan de koppelingen die de eigenaar zelf noemde
(`ochtendketen` en `myparcel_afronding` komen in het plan helemaal niet voor)
en is een deel van de aannames niet verifieerbaar zonder toegang tot de echte
shops, hPanel, n8n en MyParcel.

De belangrijkste correcties:

1. De Nginx-rewrite in het plan is fout voor OpenCart. Alle SEO-URL's zouden
   naar de homepage gaan in plaats van naar het juiste product.
2. `ssl_verify_client on;` direct aanzetten, vóórdat Cloudflare zone-level
   Authenticated Origin Pulls actief en getest is, weigert al het echte
   verkeer. Eerst `optional`, testen, dan pas afdwingen.
3. De database-hot-swap mist meer dan alleen orders. Ook klanten, sessies,
   winkelwagens en voorraadmutaties in het exportvenster moeten worden
   vergeleken. Een gemiste order handmatig opnieuw invoeren in de nieuwe
   admin geeft een nieuw ordernummer en breekt de bankreferentie van de
   klant. Ontbrekende orders moeten als SQL-rijen mét het oorspronkelijke
   `order_id` worden overgezet.
4. Hostinger na 7 dagen opzeggen kan de mailbox doden. Live wijzen MX, SPF en
   `autoconfig`/`autodiscover` naar Hostinger. Zonder apart besluit over de
   mailbox is "definitief opzeggen" een mailstoring, geen opruimactie.
5. Er bestaan twee productiesystemen voor hetzelfde domein (zie paragraaf 3).
   Zolang niet besloten is welk systeem de toekomst is, heeft verhuizen van
   het verkeerde systeem geen zin.

## 2. Wat live is geverifieerd (read-only, 8 november 2026)

| Controle | Uitkomst | Betekenis |
| --- | --- | --- |
| `https://afslank-injecties.nl/` | HTTP 200, `x-powered-by: PHP/8.3.36`, cookie `OCSESSID`, header `platform: hostinger`, `server: hcdn` | Live draait **OpenCart op PHP 8.3** achter Hostinger CDN (hCDN), niet de Node-app uit deze repository |
| `index.php?route=common/home` | 200 | OpenCart-routing actief |
| SEO-URL `/retatrutide-10mg` | 200; niet-bestaande pagina geeft 404 | SEO-URL's werken nu via `.htaccess`/LiteSpeed en moeten 1-op-1 overleven |
| `www.afslank-injecties.nl` | 301 naar `https://afslank-injecties.nl/` | Dit redirectgedrag staat **niet** in het aangeleverde plan en moet behouden blijven |
| `http://` naar `https://` | 301 | Behouden bij de nieuwe inrichting |
| `/sitemap.xml` | 200, dynamisch, met image-sitemap en `lastmod` | Geen statisch bestand; de feed-route moet op de nieuwe server werken |
| `/system/storage/` | 404; `/catalog/view/` 403 | Huidige beveiliging werkt; Nginx-equivalent moet dit minimaal evenaren |
| Nameservers | `orbit.dns-parking.com`, `horizon.dns-parking.com` (Hostinger) | DNS staat nog volledig bij Hostinger; Cloudflare voorschakelen is stap 1 |
| Apex A-record | Hostinger-IP (gedeeld), `www` is CNAME naar `cdn.hstgr.net` | Er is nu geen eigen origin-IP; dat verandert met de VPS |
| MX | `mx1/mx2.hostinger.com`; SPF `include:_spf.mail.hostinger.com`; DMARC `p=none`; `autoconfig`/`autodiscover` naar Hostinger mail | Mailbox en verzendreputatie hangen aan Hostinger. Alle records moeten exact mee naar Cloudflare-DNS |
| DKIM | Op de gangbare selectors `default` en `hostinger` geen record gevonden | Niet concluderen dat DKIM ontbreekt; de werkelijke selector moet in hPanel of in een echte mailheader worden opgezocht voordat DNS verhuist |

Let op: dit bewijst de stand van één domein op één moment. PHP-versie,
OpenCart-versie, extensies en cronjobs zijn vanaf buiten niet vast te stellen.

## 3. De repository is een tweede, ander systeem voor hetzelfde domein

Deze repository bevat **geen OpenCart**:

- Stack is React 19, TypeScript, TanStack Start, Node.js 22 en Nitro
  (`package.json`), met PostgreSQL via Neon (`pg`). Er is geen PHP, geen
  MySQL/MariaDB, geen `.htaccess`, geen `config.php`, geen `storage/`-map en
  geen `oc_order`-tabel in de hele repo.
- Mail loopt daar via een database-outbox plus Hostinger SMTP
  (`server/plugins/mail-outbox-worker.ts`, `src/lib/server/mail/`), niet via
  n8n of Gmail. Er komt geen enkele verwijzing naar n8n of een dripcampagne
  in de code voor.
- MyParcel is daar een handmatige adminactie in de app zelf
  (`src/lib/server/integrations/myparcel.server.ts`): concept, A6-label en
  tracking zijn aparte acties, idempotent, en er wordt nooit een label
  tijdens checkout aangemaakt. De scripts `ochtendketen` en
  `myparcel_afronding` bestaan niet in deze repo.
- Volgens `docs/DECISIONS.md` (2026-08-19) is Hostinger Cloud Node.js het
  beoogde productiepad voor ditzelfde domein en is de site daar bewust
  `noindex` totdat de eigenaar indexering aanzet. Live staat er echter geen
  robots-meta en draait er OpenCart (zie paragraaf 2).

Gevolg: het aangeleverde plan gaat over de **live OpenCart-shop(s)** en raakt
deze repository niet. Omgekeerd zou een deploy van deze repo het domein van
OpenCart naar de Node-app verplaatsen, met andere `robots.txt`, andere
sitemap en andere mailflow. Beslis eerst welk systeem de toekomst is. De rest
van dit document gaat over de live OpenCart-shop, omdat dat is wat klanten nu
gebruiken.

## 4. Verificatie van de claims uit het aangeleverde plan

Markering: **OK** = geverifieerd en correct. **FOUT** = technisch onjuist,
breekt bij uitvoering. **DEELS** = kern klopt, uitwerking onjuist of
onvolledig. **ONBEKEND** = niet te verifiëren met de beschikbare toegang;
niet als feit aannemen.

| # | Claim uit het plan | Oordeel | Toelichting |
| --- | --- | --- | --- |
| 1 | Hostinger negeert niets; CloudPanel/Nginx negeert `.htaccess`, dus rewrites vertalen | OK | Nginx leest inderdaad geen `.htaccess`. Vertaling is verplicht. |
| 2 | Nginx-blok: `try_files $uri $uri/ /index.php?$args;` volstaat voor SEO-URL's | **FOUT** | OpenCart heeft de padinformatie nodig als `_route_`. Met dit blok krijgt `index.php` geen `_route_` en rendert elke SEO-URL de homepage (of een fout, per versie). Correct patroon: `try_files $uri $uri/ @opencart;` met `location @opencart { rewrite ^/(.+)$ /index.php?_route_=$1 last; }`. Bron: Hostinger's eigen CloudPanel/OpenCart-handleiding en OpenCart-documentatie. |
| 3 | Sitemap-rewrite `route=extension/feed/google_sitemap` | DEELS | Klopt voor OpenCart 3. Voor OpenCart 4.x en voor extensies van derden is de route anders en moet hij uit de geïnstalleerde feed-extensie zelf komen. Het plan noemt nergens de OpenCart-versie. Daarnaast hoort dit in `location = /sitemap.xml`, niet als losse server-level `rewrite ... last;`. Live is de sitemap dynamisch, dus deze route moet vóór de switch op de nieuwe server getest zijn. |
| 4 | Alleen `.tpl/.twig/.ini/.log` blokkeren is genoeg | DEELS | Mist minimaal: `system/storage/` afschermen (live nu 404), verborgen bestanden (`.git`, `.env`, `.htaccess`), `.txt` behalve `robots.txt`, en PHP-uitvoering onder `image/` en uploadmappen voorkomen. |
| 5 | In CloudPanel plak je een extra `location /` boven de bestaande | **FOUT** | Een tweede `location /` in hetzelfde serverblok geeft `duplicate location` en Nginx herlaadt niet. In CloudPanel moet de bestaande Vhost worden **bewerkt** via de Vhost Editor; met de hand bestanden in `sites-enabled` wijzigen wordt bij de volgende panelactie overschreven. |
| 6 | De storage-map staat op Hostinger meestal één niveau boven `public_html` | DEELS | Alleen waar als iemand hem daar bij installatie heen heeft verplaatst. OpenCart start met `system/storage` **in** de webroot. De enige waarheid zijn `DIR_STORAGE` (en in OpenCart 4 ook de cache/download/session-definities) in `config.php` én `admin/config.php` van de echte shop. Download exact die map; gok de locatie niet. |
| 7 | Uploaden als site user, anders `chown -R SITE_USER:SITE_USER /home/SITE_USER/` | DEELS | Eigenaarschap klopt als risico. Maar de herstelopdracht over de hele homedir maskeert verkeerde plekken en zegt niets over rechten (mappen 755, bestanden 644, alleen `storage/`, `image/cache/` en andere schrijfplekken schrijfbaar voor de PHP-FPM-pooluser). Controleer daarna als site user, niet als root. |
| 8 | CloudPanel-installatie met `DB_ENGINE=MARIADB_10.11` op Ubuntu 24.04 | OK | Letterlijk de gedocumenteerde CloudPanel-installatie. Wel de door CloudPanel gepubliceerde sha256-checksum van `install.sh` meenemen; die ontbreekt in het plan. |
| 9 | Origin CA-certificaat (15 jaar) plus Full (Strict) | OK | Cloudflare documenteert 5475 dagen geldigheid en Full (Strict) met Origin CA. Voorwaarde: certificaat dekt apex én `www`, en de modus pas op Strict zetten als de nieuwe origin het certificaat echt serveert, anders krijgt iedereen een 526. |
| 10 | Eigen zone-level Authenticated Origin Pulls met `ssl_verify_client on;` | DEELS | Mechanisme klopt (Cloudflare documenteert: eerst `ssl_verify_client optional;`, verkeer bevestigen, dan pas `on`). Het plan slaat de testfase over. Direct `on` terwijl de zone-toggle, het certificaatpad of de CA niet klopt, weigert ook Cloudflare zelf. Ook: per Cloudflare-zone een eigen clientcertificaat; multi-store over meerdere zones betekent dit werk per zone. |
| 11 | `ssl_reject_handshake on;` in `/etc/nginx/sites-enabled/default.conf` | DEELS | De directive is correct (Nginx 1.19.4+) en voorkomt dat scanners zonder SNI een certificaat zien. Maar CloudPanel genereert zijn eigen vhosts; het genoemde pad en een handmatig default-blok kunnen conflicteren met een al bestaande `default_server` of worden overschreven. Er hoort ook een catch-all op poort 80 bij (`return 444;`), plus dezelfde behandeling voor IPv6. Scanner stuurt de echte domeinnaam als SNI, dan helpt dit niets; daar zijn mTLS en firewall voor. Dat staat goed in het plan, maar de combinatie moet als één geheel getest worden. |
| 12 | UFW in CloudPanel: poort 80/443 openzetten met Source-keuze "Cloudflare" | ONBEKEND / waarschijnlijk onjuist als UI-beschrijving | Gedocumenteerd is: de site-toggle "Allow traffic from Cloudflare only" is een **Nginx**-include (`/etc/nginx/cloudflare/ips`, dagelijks om 06:00 bijgewerkt via `clpctl cloudflare:update:ips`). Voor UFW moeten de Cloudflare-ranges als losse CIDR-regels worden toegevoegd (momenteel 15 IPv4- en 7 IPv6-ranges, bron `cloudflare.com/ips-v4` en `ips-v6`) en daarna actueel worden gehouden. Een verouderde statische UFW-lijst is zelf een toekomstige storing. Beide lagen zetten zoals het plan wil is prima, maar beschrijf ze als wat ze zijn. |
| 13 | Fase 4-testen via `/etc/hosts` op je Mac | DEELS | Werkt, maar alleen vóór Fase 5. Zodra Origin CA plus mTLS aanstaat, faalt een directe browser-test op het origin-IP per ontwerp (geen clientcertificaat, certificaat alleen vertrouwd door Cloudflare). Het plan moet dat expliciet zeggen, anders ga je na Fase 5 een "storing" debuggen die de bedoeling is. Test na Fase 5 uitsluitend via Cloudflare zelf. |
| 14 | Cache-bypass op URL's met `route=checkout/cart/account` | DEELS | Cloudflare cached HTML standaard niet en OpenCart zet sessiecookies; de regel is vooral onschadelijk. Maar de match moet op de querystring (`http.request.uri.query`) en daarnaast horen `/admin` en de SEO-vormen van cart/checkout-URL's erbij. Controleer ook of er op Hostinger een page-cache-extensie of hCDN-caching meedraait die op de VPS niet bestaat; anders verandert de snelheid zonder dat iemand het doorheeft. |
| 15 | Private Layer Q16: 2 dedicated cores, 8 GB, 100 GB NVMe, $59 per maand, Zwitserland | OK (specs en prijs) | Letterlijk de actuele aanbiederspagina, gecontroleerd op 8 november 2026. De latency van circa 14 ms naar Amsterdam is **niet** gemeten en dus ONBEKEND; zelf meten via de looking glass van de aanbieder vóór aankoop. |
| 16 | AlexHost Moldavië 4 tot 8 GB NVMe als alternatief | DEELS | Actueel Moldavië-aanbod: U2 is 2 vCore/4 GB/40 GB voor 10 euro, U4 is 4 vCore/8 GB/80 GB voor 16 euro per maand, maar met **100 Mbps gedeelde** netwerkpoort. Het plan noemt die bandbreedtebeperking niet; voor een shop met veel productafbeeldingen is dat een echte keuze, geen detail. Latency circa 28 ms eveneens ongemeten. |
| 17 | Registraradvies InternetBS of NiceNIC, SIDN-voorbehoud bij `.nl` | ONBEKEND | Niet technisch geverifieerd in deze audit en ook niet nodig voor de verhuizing zelf. Registrarverhuizing en nameserverwijziging zijn twee aparte handelingen; het plan zegt dat terecht. Doe ze nooit tegelijk met de servermigratie. |
| 18 | "0 seconden downtime" en handmatige ordercorrectie achteraf | DEELS, met een **FOUT** | Zie paragraaf 5, punten B6 en B7. De nacontrole op alleen `oc_order` is onvoldoende en handmatig opnieuw invoeren breekt ordernummers. |
| 19 | De drie toevoegingen van Codex (n8n-richting, beide firewalls, starttijd noteren) | OK | Alle drie terecht. Ze zijn in het gecorrigeerde runbook hieronder verwerkt en uitgebreid. |

## 5. Concrete uitvoeringsfouten die het plan nog mist

### B1. DNS-overgang naar Cloudflare is zelf een mailrisico

Cloudflare importeert bij het toevoegen van een domein niet gegarandeerd alle
records. Live staan er MX-records naar Hostinger, SPF, DMARC (`p=none`), een
Google-verificatie-TXT en mail-autodiscovery. Ontbreekt er één record na de
nameserverwijziging, dan is de mail stuk vóórdat de VPS er iets mee te maken
heeft. Verplicht: volledige zone-export uit hPanel, record-voor-record
vergelijken in Cloudflare, inclusief alle subdomeinen en TXT-records, en pas
dan nameservers omzetten. DKIM-selector opzoeken in hPanel of in de headers
van een echte verzonden mail.

### B2. De twee MyParcel-scripts ontbreken volledig in het plan

De eigenaar noemt `ochtendketen` en `myparcel_afronding` als dagelijkse
scripts. Het plan behandelt ze nergens. Onbekend is: waar ze draaien
(Hostinger cron, n8n, een lokale machine), hoe ze inloggen (domein-API of
directe databaseverbinding), of de MyParcel API-sleutel een IP-whitelist
heeft, en of ze idempotent zijn als ze een dag dubbel of helemaal niet
draaien. Als ze op Hostinger cronjobs staan, stoppen ze zodra Hostinger weg
is. Deze inventaris is een harde voorwaarde vóór de switch, geen nazorg.

### B3. De n8n-koppeling moet op richting én op DNS worden gecontroleerd

De Codex-opmerking over de richting klopt en gaat verder dan testen:

- Pusht OpenCart naar n8n (webhook uitgaand): na de switch verandert het
  bron-IP van die calls. Controleer of n8n of Gmail-kant een IP-whitelist,
  webhooksecret of handtekening gebruikt.
- Pollt n8n via het domein: dan ziet n8n na de Cloudflare-A-recordwijziging
  automatisch de nieuwe server. Test dat met één echte testorder, niet met
  een handmatige webhook-replay.
- Verbindt n8n direct met MySQL op 3306: poort 3306 openzetten op een verder
  dichtgetimmerde VPS is het zwakste punt van het hele ontwerp. Alleen met
  bron-IP-restrictie, een eigen databasegebruiker met minimale rechten en
  bij voorkeur een SSH- of WireGuard-tunnel. Noteer dat Hostinger shared
  hosting meestal helemaal geen externe 3306-toegang geeft; als dit nu al
  werkt, is de huidige inrichting anders dan het plan aanneemt en moet dat
  eerst worden uitgezocht.

### B4. Echt klant-IP in OpenCart komt niet vanzelf mee

Het plan laat na de switch controleren "of je het echte klant-IP ziet en niet
een Cloudflare-IP", maar configureert nergens hoe. Zonder `real_ip`-instelling
in Nginx (alleen Cloudflare-ranges als `set_real_ip_from`, header
`CF-Connecting-IP`) logt OpenCart overal Cloudflare-IP's. Dat raakt
orderregistratie, fraude-inschatting en adminlogs. Instellen in de CloudPanel
Vhost en testen met een eigen bestelling vanaf een ander netwerk.

### B5. Niet alleen poort 22, 80, 443 en 8443 bestaan

CloudPanel installeert meer diensten dan het plan opsomt (onder andere FTP en
de database). Een firewallplan dat alleen de genoemde poorten behandelt, laat
de rest op de CloudPanel-defaults staan. Verplicht vóór livegang: volledige
poortinventaris op de VPS zelf (`ss -tulpn`, `ufw status verbose`) en iedere
luisterende poort expliciet toestaan voor de juiste bron of dichtzetten.
Hetzelfde geldt voor IPv6: heeft de VPS een IPv6-adres en staat er een AAAA
of een open v6-firewall, dan is de hele v4-afscherming te omzeilen. Geen AAAA
naar de origin publiceren en v6-firewall gelijk aan v4.

Bij de installatie zelf zit nog een tijdvenster dat het plan onderschat:
tussen CloudPanel-installatie en het aanmaken van de admin-gebruiker kan
iedereen die poort 8443 bereikt dat als eerste doen (CloudPanel waarschuwt
hier zelf voor). Zet de firewallregel voor 8443 daarom direct bij het
bestellen klaar waar de aanbieder dat toelaat, of maak de admin binnen
enkele minuten aan en beperk de poort daarna als eerste handeling.

### B6. "Nul seconden downtime" is een streven, geen eigenschap van dit plan

Omdat al het verkeer in Fase 1 al via Cloudflare loopt, is het omzetten van
het A-record aan de edge vrijwel direct actief. Dat deel klopt. Wat niet
klopt, is de suggestie dat daarmee alles gedekt is:

- De database-export is een momentopname. Alles wat daarna op de oude shop
  verandert en vóór de A-wijziging niet in de export zit, moet in de
  nacontrole worden gevonden. Dat is meer dan `oc_order` (zie B7).
- Bestaande Cloudflare-naar-Hostinger-verbindingen en keep-alive-pools kunnen
  nog korte tijd naar de oude origin gaan. De nacontrole moet daarom niet
  alleen na 10 minuten, maar ook de volgende ochtend draaien. Dat staat deels
  in het plan en blijft staan.
- PHP-sessies en winkelwagens van bezoekers die tijdens de switch actief
  zijn, gaan verloren als de sessieopslag niet meeverhuist. Bij dit volume
  betekent dat hooguit een handvol opnieuw te vullen winkelwagens, maar
  "nul impact" is het niet. Benoem het eerlijk of plan de switch op het
  rustigste moment met dat verlies geaccepteerd.

### B7. Ontbrekende orders overzetten: als data, niet als handwerk

Een order die na de export op de oude server landt, heeft daar al een
`order_id`, een betaalreferentie voor de klant en mogelijk al een
bevestigingsmail via n8n. Die order handmatig opnieuw aanmaken in de nieuwe
admin geeft een **nieuw** nummer, kan voorraad en rapportages dubbel tellen
en stuurt mogelijk een tweede bevestiging. Correct herstel:

1. Vergelijk vanaf de genoteerde starttijd minimaal `oc_order`,
   `oc_order_product`, `oc_order_total`, `oc_order_history`, `oc_customer`,
   nieuwe adressen en retouren tussen oud en nieuw.
2. Ontbrekende orders als SQL-rijen importeren mét behoud van het
   oorspronkelijke `order_id` en alle gekoppelde tabellen, en daarna de
   auto-increment van `oc_order` boven het hoogste overgezette nummer zetten.
3. Per overgezette order expliciet vastleggen of de bevestigingsmail al door
   de oude keten is verstuurd, zodat n8n hem niet opnieuw stuurt.
4. Rollback na livegang op de nieuwe server is hiermee ook begrensd: zodra er
   op de nieuwe database echte orders staan, is "A-record terugzetten" geen
   volledige rollback meer. Leg vóór de switch vast wie beslist en op basis
   van welke fouten er wordt teruggerold, inclusief het samenvoegen van
   orders uit beide databases.

### B8. PHP-inrichting moet gelijk zijn, niet alleen de versie

Live draait PHP 8.3.36. Op de VPS moet minimaal gelijk zijn: PHP 8.3, de
OpenCart-extensies (onder andere curl, gd, zip, mbstring, mysqli, openssl,
xml), `memory_limit`, `max_execution_time`, uploadlimieten voor
extensie-installaties en de tijdzone. Verschillen hierin geven fouten die er
uitzien als migratieschade maar dat niet zijn. Exporteer de PHP-info of de
systeeminstellingen uit de oude adminomgeving als referentie.

Hostinger cronjobs verhuizen ook niet vanzelf. Inventariseer in hPanel alle
cronjobs (OpenCart kent er zelf en via extensies meerdere) en maak ze in
CloudPanel opnieuw aan onder de site user.

### B9. Origin-IP lekt via meer dan alleen poort 443

De vier lagen in het plan dekken de hoofdroute goed af. Resterende lekken om
expliciet te sluiten of te accepteren:

- DNS-geschiedenis: zodra er ooit een DNS-only record (bijvoorbeeld `direct.`,
  `origin.`, `ftp.`, `ssh.`) naar de VPS wijst of heeft gewezen, is het IP
  vindbaar. Publiceer uitsluitend proxied records naar de origin.
- De CloudPanel-interface op 8443 is vanaf het kale IP bereikbaar als de
  firewallregel faalt; scanners vinden de panel-login, ook al vinden ze de
  shop niet. De IP-restrictie op 8443 is dus geen comfort maar onderdeel van
  de afscherming.
- Hostname en PTR-record van de VPS mogen de shopdomeinnaam niet bevatten.
- Uitgaande koppelingen (n8n-webhooks, MyParcel, eventuele externe API's)
  zien het VPS-IP aan de andere kant. Dat is geen publiek lek, maar het IP
  staat dan wel in logs van derden. Onvermijdelijk bij deze architectuur;
  bewust accepteren.

## 6. Gecorrigeerd runbook voor afslank-injecties.nl (OpenCart)

Dit runbook vervangt het aangeleverde stappenplan. Het voert niets uit; het
is de checklist voor het moment dat de eigenaar `ja` geeft.

### Fase 0. Inventaris (blokkerend, geen wijzigingen)

- [ ] OpenCart-versie en PHP-versie vastleggen uit de admin (Systeem/
      instellingen en PHP-info), inclusief extensielijst.
- [ ] `config.php` en `admin/config.php` uitlezen: `DIR_STORAGE` en alle
      andere `DIR_`-paden, databasehost en of de database lokaal op Hostinger
      draait of extern.
- [ ] Alle domeinen op een rij: hoofddomein, `www`, eventuele multi-store
      domeinen, en per domein de store-instellingen (URL en SSL-URL) in
      OpenCart.
- [ ] Volledige DNS-zone exporteren uit hPanel; DKIM-selector vinden.
- [ ] Mailstromen tekenen: welke mail verstuurt OpenCart zelf, welke loopt
      via n8n/Gmail, welk afzendadres en welke SPF/DKIM horen daarbij.
      Dripcampagne: waar draait die en wat triggert hem.
- [ ] n8n-richting vaststellen (push, poll via domein, of directe DB) en de
      drie scenario's uit B3 doorlopen.
- [ ] `ochtendketen` en `myparcel_afronding` inventariseren volgens B2:
      draaiplaats, schema, inlogmethode, API-sleutels, IP-whitelists,
      idempotentie, handmatige herstartprocedure.
- [ ] Alle Hostinger cronjobs exporteren.
- [ ] Besluit over de mailbox: blijft er een Hostinger-mailproduct bestaan,
      verhuist de mailbox mee, of gaat alle mail definitief via Gmail. Zonder
      dit besluit wordt Hostinger niet opgezegd.
- [ ] Besluit over deze repository: blijft de Node-app een toekomstplan naast
      OpenCart, of vervalt dat spoor. Zie paragraaf 3.

### Fase 1. Cloudflare voorschakelen (shop blijft op Hostinger)

- [ ] Cloudflare-account aanmaken; domein toevoegen.
- [ ] Geïmporteerde DNS-zone record-voor-record vergelijken met de export uit
      Fase 0, inclusief MX, SPF, DMARC, DKIM, verificatie-TXT's en alle
      subdomeinen. Niets proxied zetten dat niet proxied hoort (mailrecords
      blijven DNS-only).
- [ ] A-records `@` en `www` proxied naar het huidige Hostinger-IP laten
      wijzen; SSL-modus op Full (het huidige openbare Hostinger-certificaat
      voldoet; Strict pas in Fase 5).
- [ ] Redirect-regel aanmaken: `www` naar apex, 301, zoals live nu ook gebeurt
      (controle uit paragraaf 2). Idem http naar https.
- [ ] Nameservers omzetten en wachten tot Cloudflare het domein actief meldt.
- [ ] Controle: shop, checkout-pagina, admin-login, sitemap en één
      n8n-cyclus werken via Cloudflare. Registrarverhuizing los hiervan en
      niet in dezelfde week.

### Fase 2. VPS inrichten (nog niets wijst ernaar)

- [ ] VPS bestellen na eigen latency-meting vanaf Amsterdam via de looking
      glass van de aanbieder; plan en bandbreedte expliciet vergelijken
      (Private Layer Q16 tegen AlexHost U4 scheelt onder andere een factor
      netwerkpoort).
- [ ] CloudPanel installeren met de officiële opdracht inclusief
      sha256-controle van `install.sh`; direct de admin aanmaken, 2FA aan,
      en poort 8443 en 22 beperken tot eigen IP. Provider-consoletoegang
      noteren als nooduitgang bij een dynamisch thuis-IP.
- [ ] Externe backups koppelen en één testterugzetting doen op een lege
      test-site. Een backup die nooit is teruggezet, telt niet als backup.
- [ ] Site aanmaken in CloudPanel met dezelfde PHP-versie als live en de
      extensielijst uit Fase 0; site user en document root noteren.

### Fase 3. Shop kopiëren en Nginx correct configureren

- [ ] Bestanden kopiëren als site user: webroot plus de echte storage-map uit
      Fase 0, op de plek waar de nieuwe `config.php` naar wijst.
- [ ] Database importeren in MariaDB; beide `config.php`-bestanden aanpassen
      (database plus alle paden).
- [ ] In de CloudPanel **Vhost Editor** (niet in het bestand op schijf) het
      OpenCart-patroon zetten, als vervanging van de bestaande `location /`:

```nginx
location / {
    try_files $uri $uri/ @opencart;
}

location @opencart {
    rewrite ^/(.+)$ /index.php?_route_=$1 last;
}

location = /sitemap.xml {
    rewrite ^(.*)$ /index.php?route=HIER_DE_FEEDROUTE_UIT_JOUW_OPENCART last;
}

location = /googlebase.xml {
    rewrite ^(.*)$ /index.php?route=HIER_DE_FEEDROUTE_UIT_JOUW_OPENCART last;
}

location ^~ /system/storage/ {
    return 404;
}

location ~* \.(tpl|twig|ini|log)$ {
    return 404;
}

location ~ /\.(?!well-known) {
    return 404;
}
```

- [ ] Real-IP toevoegen in dezelfde Vhost, zodat OpenCart het klant-IP ziet:

```nginx
set_real_ip_from 173.245.48.0/20;
# vul hier alle actuele Cloudflare-ranges in (v4 en v6) of gebruik de
# door CloudPanel bijgehouden include als die in de Vhost beschikbaar is
real_ip_header CF-Connecting-IP;
real_ip_recursive on;
```

- [ ] `nginx -t` draaien vóór iedere herlaad; bij een fout de vorige Vhost
      terugzetten.

### Fase 4. Testen op de nieuwe server (vóór afscherming)

- [ ] Via `/etc/hosts` op de eigen machine: homepage, categorie, product met
      SEO-URL, zoekpagina, winkelwagen, volledige testbestelling, admin,
      sitemap-URL (moet XML met producten geven), en het uploaden van een
      afbeelding in admin.
- [ ] Controleren dat `/system/storage/` 404 geeft en een `.twig`-pad niet
      downloadbaar is.
- [ ] Multi-store domeinen elk apart testen, indien van toepassing.
- [ ] `/etc/hosts`-regel daarna direct weer verwijderen.
- [ ] Verwachting expliciet vastleggen: na Fase 5 faalt deze directe test
      bewust. Wie dat niet weet, gaat een werkende afscherming als storing
      behandelen.

### Fase 5. Afschermen (volgorde is de beveiliging)

- [ ] Origin CA-certificaat aanmaken voor apex en wildcard; installeren in
      CloudPanel.
- [ ] Zone-level Authenticated Origin Pulls: eigen clientcertificaat
      uploaden, CA op de VPS plaatsen, en in de Vhost eerst:

```nginx
ssl_client_certificate /etc/nginx/certs/cf-client-ca.crt;
ssl_verify_client optional;
```

- [ ] Testen via het echte domein over Cloudflare. Werkt dat, dan pas
      `ssl_verify_client on;` en opnieuw testen.
- [ ] Catch-all voor onbekende SNI op 443 en poort 80 (`return 444;`), op een
      manier die CloudPanel-regeneratie overleeft; na iedere panelwijziging
      opnieuw controleren. Nginx-versie controleren (1.19.4+ vereist).
- [ ] Firewall in twee lagen, als wat ze zijn: site-toggle "Allow traffic
      from Cloudflare only" (Nginx-laag, CloudPanel houdt de lijst bij) én
      UFW-regels met de actuele Cloudflare-CIDR's voor 80/443 (v4 én v6),
      plus een procedure om die lijst bij te werken.
- [ ] Volledige poortcontrole volgens B5, inclusief IPv6-besluit.
- [ ] Cloudflare SSL-modus nu pas op Full (Strict) zetten.
- [ ] Cache- en redirectregels controleren: bypass voor checkout, cart,
      account en admin; www-naar-apex blijft werken.

### Fase 6. Omschakeling

- [ ] Rustig nachtelijk tijdstip; starttijd en hoogste `order_id` noteren
      vóór de export.
- [ ] Verse database-export van Hostinger; import op de VPS; steekproef op
      aantallen (orders, klanten, producten) oud tegen nieuw.
- [ ] A-records `@` en `www` in Cloudflare naar het VPS-IP zetten.
- [ ] Directe acceptatietest vanaf een netwerk buiten het eigen huis:
      homepage, product, testbestelling, admin toont echt klant-IP, order
      zichtbaar in nieuwe admin, n8n pikt de order op, bevestigingsmail komt
      aan, MyParcel-flow voor die testorder gecontroleerd, sitemap laadt.
- [ ] Nacontrole volgens B7 na 10 minuten én de volgende ochtend; ontbrekende
      data als SQL overzetten met behoud van ID's, nooit handmatig
      overtypen.
- [ ] Rollbackbesluit en eigenaar daarvan vooraf benoemd hebben; na de
      eerste echte nieuwe order is rollback een databasesamenvoeging, geen
      knop.

### Fase 7. Nazorg

- [ ] Hostinger minimaal 7 dagen als terugval laten staan, maar er niet meer
      in werken. Pas opzeggen als het mailboxbesluit uit Fase 0 is
      uitgevoerd en de DNS volledig stabiel draait.
- [ ] Cronjobs (inclusief de twee MyParcel-scripts, waar ze ook draaien)
      aantoonbaar één volledige dagcyclus laten draaien vanaf de nieuwe
      inrichting en de uitvoer controleren.
- [ ] Na een week: scancontrole op het kale VPS-IP (443 zonder SNI, 80,
      8443) vanaf een extern netwerk herhalen.

## 7. Wat voor de andere shops nog volledig onbekend is

Voor iedere andere shop dan `afslank-injecties.nl` geldt dit runbook pas na
dezelfde Fase 0-inventaris per shop. Niet aannemen: OpenCart-versie,
multi-store of losse installaties, PHP-versie, waar de database draait, welke
extensies eigen rewrites of cronjobs meebrengen, en of n8n en de
MyParcel-scripts per shop of centraal draaien. "Websites" meervoud betekent
in de praktijk: dit runbook per shop doorlopen, met één gedeelde VPS- en
Cloudflare-inrichting maar aparte sites, databases en certificaten per zone.

## 8. Beslissingen die vóór uitvoering nodig zijn

1. Welk systeem is de toekomst van `afslank-injecties.nl`: de live
   OpenCart-shop verhuizen, of deze repository alsnog live brengen. Beide
   tegelijk kan niet.
2. Aanbiederkeuze na eigen latency- en bandbreedtemeting, niet op basis van
   de getallen uit het aangeleverde plan.
3. Wat er met de Hostinger-mailbox gebeurt. Dit bepaalt of Hostinger ooit
   volledig kan worden opgezegd.
4. Waar `ochtendketen` en `myparcel_afronding` draaien en wie ze na de
   verhuizing beheert.
5. Expliciet `ja` op de uiteindelijke verhuizing zelf, conform de
   autorisatiegrens in `AGENTS.override.md`, omdat klanten de wijziging
   kunnen merken en er kosten en credentialwijzigingen aan vastzitten.

## Bronnen (geraadpleegd 8 november 2026)

- Cloudflare, Authenticated Origin Pulls (zone-level) en Origin CA / Full
  (Strict): developers.cloudflare.com/ssl/origin-configuration
- Cloudflare IP-ranges: cloudflare.com/ips-v4 en cloudflare.com/ips-v6
- CloudPanel-documentatie: Vhost Editor, Security ("Allow traffic from
  Cloudflare only", `clpctl cloudflare:update:ips`), installatie op Ubuntu
  24.04: cloudpanel.io/docs/v2
- Hostinger, CloudPanel/OpenCart SEO-URL-configuratie (`@opencart`,
  `_route_`): hostinger.com/support, OpenCart VPS-template
- OpenCart-documentatie, SEO-URL's: docs.opencart.com/design/seo-url
- Nginx-documentatie, HTTPS-servers en `ssl_reject_handshake`:
  nginx.org/en/docs/http/configuring_https_servers.html
- Private Layer, Q16 Fast Linux VM: privatelayer.com/virtualservers.php
- AlexHost, VPS Moldavië (U2/U4, 100 Mbps gedeeld): alexhost.com/vps
