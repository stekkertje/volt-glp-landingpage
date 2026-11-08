# Audit en gecorrigeerd migratieplan: weg bij Hostinger

Status: audit uitgevoerd, migratie **niet** uitgevoerd.
Datum van de controles: 8 november 2026, rond 10:06 uur (Europe/Amsterdam).
Scope van deze audit: het aangeleverde OpenCart-migratieplan, de live shop op
`afslank-injecties.nl` (alleen read-only controles vanaf internet) en deze
repository. Er is niets gekocht, geen DNS gewijzigd, geen server ingericht en
geen productiehandeling gedaan.

Herziening dezelfde dag, na toegang tot de Mac van de eigenaar: de paragrafen
2B, 5 (B2, B3) en Fase 0 zijn daarna alsnog geverifieerd tegen de echte lokale
bronnen: `/Users/mpp/payment-batch/` (ochtendketen, MyParcel-afronding,
OpenCart-client), de OpenCart multistore-handover op het bureaublad, een
read-only OpenCart-instellingenexport van 17 oktober 2026 en 24 geëxporteerde
n8n-workflows (stand 4 november 2026, instance op n8n Cloud). Secrets,
wachtwoorden, API-keys en klantgegevens zijn daarbij niet overgenomen; er is
alleen gekeken naar structuur, hostnamen, schema's en instellingsnamen. Wat
alleen op de Hostinger-server zelf te zien is (de echte `config.php`-paden,
hPanel-cronjobs, actuele adminversie) blijft als open punt gemarkeerd.

Een daadwerkelijke verhuizing is zichtbaar en merkbaar voor klanten en valt
daarom onder de autorisatiegrens in `AGENTS.override.md`: pas uitvoeren na een
korte impactsamenvatting en een expliciet `ja` van de eigenaar.

## 1. Conclusie in het kort

Het aangeleverde plan is **niet uitvoerbaar zoals het er staat**. De richting
(Cloudflare ervoor, eigen VPS erachter, origin afschermen) klopt in grote
lijnen, maar het plan bevat concrete technische fouten waardoor SEO-URL's
breken, Nginx niet herlaadt of Cloudflare-verkeer juist wordt geweigerd.
Daarnaast mist het plan de koppelingen die de eigenaar zelf noemde. Die zijn
inmiddels op de Mac geverifieerd (paragraaf 2B) en ze veranderen het plan op
het belangrijkste punt: de orderbevestigingen komen **niet** uit n8n/Gmail,
zoals het plan aanneemt, maar uit OpenCart zelf via Hostinger-sendmail. De
vaste randvoorwaarde "de VPS verstuurt geen mail" is voor deze shops dus
onwaar, tenzij de mailinstelling bewust wordt omgezet.

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
5. Dit is geen verhuizing van één shop. Het is één OpenCart 3.x
   multistore-installatie met één gedeelde database voor steroiden.com,
   anabolenkopen.nl en afslank-injecties.nl (plus store-id's voor
   stacker-pro.com en onderliggende landingspagina's). Eén switch raakt alle
   shops tegelijk (paragraaf 2B).
6. De dagelijkse keten draait op de Mac zelf, niet op Hostinger: launchd start
   doordeweeks de ochtendketen, die rechtstreeks met de OpenCart-database
   praat en daarna via de shopdomeinen de OpenCart-API aanroept. Na de
   verhuizing moeten database-toegang voor de Mac, het API-pad door
   Cloudflare en het echte klant-IP in PHP allemaal opnieuw kloppen, anders
   stopt de betaal- en verzendverwerking de ochtend erna (paragraaf 5, B10).
7. Er bestaan twee productiesystemen voor het domein afslank-injecties.nl
   (zie paragraaf 3). Zolang niet besloten is welk systeem de toekomst is,
   heeft verhuizen van het verkeerde systeem geen zin.

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

## 2B. Wat op de Mac is geverifieerd (de echte inrichting)

Bronnen: `/Users/mpp/payment-batch/`, de multistore-handover
(`Desktop/Steroiden.com/opencart_multistore_handover.txt`), de read-only
OpenCart-export van 17 oktober 2026
(`Desktop/Stacker-pro/old/Stacker-Pro-Audit-2026-10-17/onderzoek/`) en de
n8n-workflowexports van 4 november 2026. Alle vier de live shops zijn daarna
nogmaals read-only vanaf internet gecontroleerd.

| Onderdeel | Gevonden werkelijkheid | Gevolg voor de verhuizing |
| --- | --- | --- |
| OpenCart-installatie | Eén OpenCart 3.x multistore-installatie, primaire webroot onder steroiden.com, database met prefix `oc_`, MariaDB 11.8.9 (export oktober 2026), PHP 8.3.36 live op alle shops | Niet per shop verhuizen. Bestanden, database en configuratie verhuizen één keer, voor alle stores tegelijk |
| Stores | Store 0 steroiden.com, 1 anabolenkopen.nl, 2 afslank-injecties.nl; in `opencart_client.py` ook store 3 `www.stacker-pro.com` en store-id's 4 tot en met 7 die technisch naar steroiden.com routeren (landingspagina's zoals winstrol-kopen.nl en dianabol-kopen.nl). Alle gecontroleerde domeinen geven live `OCSESSID` en PHP 8.3 op Hostinger | Cloudflare moet per domein/zone worden ingericht, maar de origin-switch is één moment voor alles. Testmatrix moet alle stores bevatten |
| Aanpassingen in de shop | Eigen mailsysteem `catalog/model/account/shopmail.inc.php` en `shopmail.php`, trackingkolommen op `oc_order` en `oc_order_history`, aangepaste admin, en 3 actieve OCMods (multistore/canonical routing, thema-assets, non-www 301) | Bestanden kopiëren is niet genoeg: de OCMod-cache (`storage/modification`) moet mee of opnieuw worden opgebouwd, en de maatwerkbestanden moeten als aparte checklist worden overgezet en getest |
| Winkelmail | `config_mail_engine = mail`, verzending via Hostinger sendmail (`/usr/sbin/hsendmail`) volgens de handover. Centrale alerts gaan naar een Gmail-inbox, maar de klantmail zelf verstuurt OpenCart | Het plan-uitgangspunt "VPS verstuurt geen mail, n8n doet dat" klopt niet. Op de VPS moet PHP-mail opnieuw worden ingericht (eigen sendmail/postfix betekent verzenden vanaf het VPS-IP met SPF/DKIM-gevolgen per shopdomein) of OpenCart moet per store op SMTP worden gezet. Dit is een ontwerpbesluit vóór de switch, geen detail erna |
| n8n | Instance op n8n Cloud (host `stackerpro.app.n8n.cloud`). Van 24 geëxporteerde workflows waren er op 4 november 2026 drie actief: "Stacker Pro - Klantmails na betaling (drip)", "Stacker Pro - directe mail na betaling" en het contactformulier; die halen hun gegevens hoofdzakelijk uit de Wix-kant van stacker-pro.com. De OpenCart-varianten ("OpenCart winkelmail", "drip OpenCart [uit]", "directe mail na betaling [OpenCart uit]") staan expliciet uit | Voor de OpenCart-verhuizing hoeft n8n vrijwel zeker niets te veranderen, maar dat moet met één testorder per store worden bewezen in plaats van aangenomen. De lokale `~/.n8n` op de Mac is alleen een testinstantie met één Telegram-workflow en is niet de productie |
| Ochtendketen | launchd-agent `com.stackerpro.ochtendketen` op deze Mac, doordeweeks vanaf 10:15 uur met herhaalpogingen. Start `ochtendketen.py`, die `daily_pro.py` aanstuurt: bankbetalingen matchen over de OpenCart-stores en Wix, exports maken, en via `opencart_client.py` orders op Paid zetten | De keten staat los van de webhost maar is volledig afhankelijk van database- en API-bereikbaarheid (zie hieronder). Een geslaagde webswitch met een gebroken keten betekent de volgende ochtend geen betaalverwerking |
| Database-toegang scripts | `opencart_client.py` verbindt vanaf de Mac rechtstreeks met de OpenCart-database (PyMySQL, instellingen `OPENCART_DB_HOST/PORT/NAME/USER` uit een `.env` buiten de scriptsmap). De webshop zelf gebruikt volgens de handover MySQL op localhost | Op de VPS moet externe databasetoegang voor het Mac-IP worden ingericht (alleen dat IP, eigen gebruiker, bij voorkeur tunnel) of de scripts moeten anders gaan werken. Poort 3306 publiek openzetten is geen optie. De `.env` van de scripts moet mee in de switch-checklist |
| Order-API notificaties | Na een databasemutatie roept het script per store `https://<shopdomein>/index.php?route=api/order/history` aan met een zelf ingevoegde `oc_api_session`. OpenCart controleert daarbij het bron-IP; het script schrijft het database-bron-IP vooraf in `oc_api_ip` | Achter Cloudflare ziet PHP standaard het Cloudflare-IP in plaats van het Mac-IP. Zonder correcte `real_ip`-configuratie (B4) en een Cloudflare-pad dat deze API-calls niet blokkeert (geen bot-challenge op dat pad, gebruikersagent van urllib doorlaten) mislukken de Paid- en Shipped-mails. Dit moet vóór de switch met een testorder per store zijn bewezen |
| MyParcel-afronding | `myparcel_afronding.py`, aangeroepen vanuit `daily_pro.py`: haalt zendingen op bij `api.myparcel.nl`, zet betaalde OpenCart-orders op Shipped en triggert de verzendmail via dezelfde OpenCart-API. MyParcel-sleutel komt uit dezelfde `.env`; er is in de code geen IP-whitelist aan MyParcel-kant gezien | Geen Hostinger-cronjob, dus verhuist niet mee en breekt niet door Hostinger-opzegging. Breekt wel als database, domein-API of mail het na de switch niet doen |
| Wat nog steeds niet lokaal te zien is | De echte `config.php` en `admin/config.php` (inclusief `DIR_STORAGE`) staan alleen op de server. Hetzelfde geldt voor hPanel-cronjobs, de exacte puntversie van OpenCart in de admin en eventuele Hostinger-specifieke PHP-instellingen | Fase 0 houdt een korte serverinventaris via hPanel/SSH. Zonder die gegevens blijft vooral het storage-pad een aanname |

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

### B2. De twee MyParcel-scripts ontbreken volledig in het plan (inmiddels geverifieerd)

Het aangeleverde plan behandelt `ochtendketen` en `myparcel_afronding`
nergens. Inmiddels is op de Mac vastgesteld hoe ze werken (paragraaf 2B):
ze draaien lokaal onder launchd en vanuit `daily_pro.py`, niet als Hostinger
cronjobs. Ze stoppen dus niet als Hostinger wordt opgezegd. Ze breken wel
als na de switch de directe databaseverbinding vanaf de Mac, het API-pad
over de shopdomeinen of de OpenCart-mail niet meer werkt. Die drie
afhankelijkheden horen als acceptatietest in de ochtend na de switch: de
keten moet één volledige cyclus groen draaien voordat de verhuizing als
geslaagd telt.

### B3. De n8n-richting is inmiddels bekend: winkelmail komt niet uit n8n

De Codex-opmerking "controleer de richting" was terecht, maar het antwoord
is nu bekend en het is anders dan beide plannen aannamen. De OpenCart
winkelmail (bestelbevestiging, betaald, verzonden, annulering, refund) wordt
door OpenCart zelf verstuurd via PHP `mail` op Hostinger-sendmail, met de
eigen templates in `shopmail.inc.php`. De actieve n8n-workflows bedienen de
Wix-kant van stacker-pro.com; de OpenCart-varianten staan uit. Gevolgen:

- Er hoeft in n8n voor deze verhuizing niets te worden omgezet, op één
  testorder per store als bewijs na.
- De mailverhuizing zit in de shop zelf: per store beslissen of de VPS zelf
  gaat versturen (dan SPF en DKIM per shopdomein inrichten en deliverability
  testen) of dat OpenCart per store op SMTP wordt gezet, bijvoorbeeld via de
  bestaande Hostinger-mailbox zolang die blijft bestaan, of via Gmail.
  Zolang dat besluit er niet is, is iedere "VPS verstuurt geen mail"-zin in
  het plan onjuist.
- Verbindt er in de toekomst toch iets direct met MySQL op 3306, dan geldt:
  alleen met bron-IP-restrictie, een eigen databasegebruiker met minimale
  rechten en bij voorkeur een tunnel. Dat geldt nu al voor de Mac-scripts
  zelf; zie B10.

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
bevestigingsmail uit OpenCart zelf. Die order handmatig opnieuw aanmaken in de nieuwe
admin geeft een **nieuw** nummer, kan voorraad en rapportages dubbel tellen
en stuurt mogelijk een tweede bevestiging. Correct herstel:

1. Vergelijk vanaf de genoteerde starttijd minimaal `oc_order`,
   `oc_order_product`, `oc_order_total`, `oc_order_history`, `oc_customer`,
   nieuwe adressen en retouren tussen oud en nieuw.
2. Ontbrekende orders als SQL-rijen importeren mét behoud van het
   oorspronkelijke `order_id` en alle gekoppelde tabellen, en daarna de
   auto-increment van `oc_order` boven het hoogste overgezette nummer zetten.
3. Per overgezette order expliciet vastleggen of de bevestigingsmail al door
   de oude shop is verstuurd, zodat hij niet opnieuw wordt verstuurd.
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

### B10. De Mac-keten stelt harde eisen aan de nieuwe server

Omdat de ochtendketen en de MyParcel-afronding vanaf deze Mac draaien, moet
de nieuwe inrichting drie dingen aantoonbaar ondersteunen:

1. Directe databasetoegang vanaf het thuis-IP van de Mac naar de nieuwe
   MariaDB, beperkt tot dat ene IP en het liefst via een SSH-tunnel die het
   script zelf opent, zodat poort 3306 niet permanent openstaat. De
   `OPENCART_DB_*`-waarden in de bestaande `.env` moeten tijdens de switch
   worden omgezet en de oude waarden moeten als terugval bewaard blijven
   tot de eerste groene ketenrun.
2. Een Cloudflare-pad voor `index.php?route=api/order/history` dat
   scriptverkeer doorlaat: geen Managed Challenge of botregel op dat pad en
   geen snelheidsblokkade op het thuis-IP. Testen met het echte script en
   een testorder, niet met alleen een browser.
3. Correct hersteld bron-IP in PHP (B4). De OpenCart-API vergelijkt het
   verzoek-IP met de door het script ingevoegde sessie; ziet PHP een
   Cloudflare-IP, dan weigert de API en blijven de Paid- en Shipped-mails
   uit, terwijl de order in de database wel al is omgezet. Dat is precies
   het soort halve storing dat pas de volgende ochtend opvalt.

## 6. Gecorrigeerd runbook voor alle OpenCart-stores tegelijk

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
- [x] Mailstromen vastgesteld (paragraaf 2B): winkelmail verstuurt OpenCart
      zelf via sendmail; n8n bedient de Wix-kant van stacker-pro.com. Open
      punt dat overblijft: het mailbesluit voor de VPS (zelf versturen met
      SPF/DKIM per domein, of OpenCart per store op SMTP zetten).
- [x] `ochtendketen` en `myparcel_afronding` geïnventariseerd (paragraaf
      2B): draaien op de Mac onder launchd en vanuit `daily_pro.py`.
      Overgebleven acties: `.env`-hostwaarden voor de switch klaarzetten en
      de acceptatietest uit B10 inplannen.
- [ ] Alle Hostinger cronjobs exporteren (staat los van de Mac-keten; nog
      niet gecontroleerd).
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
      testbestelling inclusief klantmail werken via Cloudflare. Registrarverhuizing los hiervan en
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
      zichtbaar in nieuwe admin, bevestigingsmail komt uit de nieuwe server aan, de ochtendketen-test (handmatig gestart) verwerkt een testorder inclusief MyParcel-controle,
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

## 7. Reikwijdte: één systeem, meerdere voorkanten

Inmiddels is vastgesteld dat de OpenCart-shops één multistore-systeem zijn
(paragraaf 2B). Het runbook geldt dus één keer voor het hele systeem, met
per domein een eigen Cloudflare-zone, certificaten en testbestelling. De
losse landingspagina's buiten OpenCart (zoals winstrol-kopen.nl, dat al via
Cloudflare loopt) en de Wix-kant van stacker-pro.com vallen buiten deze
verhuizing en mogen er niet stilzwijgend in worden meegenomen.

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
