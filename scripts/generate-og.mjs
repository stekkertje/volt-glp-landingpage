#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const dataUri = (relativePath, mime) => {
  const bytes = readFileSync(new URL(relativePath, import.meta.url));
  return `data:${mime};base64,${bytes.toString("base64")}`;
};

const logoUri = dataUri("../public/images/brand/logo-lockup-light.png", "image/png");
const photoUri = dataUri(
  "../public/images/producten/semaglutide-4mg-pen__01__800.webp",
  "image/webp",
);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`
    <!doctype html>
    <html lang="nl">
      <head>
        <meta charset="utf-8" />
        <style>
          * { box-sizing: border-box; }
          body {
            margin: 0;
            width: 1200px;
            height: 630px;
            overflow: hidden;
            color: #0b0c0f;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif;
            background:
              radial-gradient(circle at 78% 35%, rgba(14, 116, 132, .18), transparent 35%),
              linear-gradient(135deg, #ffffff 0%, #f4f5f7 100%);
          }
          main {
            position: relative;
            display: grid;
            grid-template-columns: 1.08fr .92fr;
            align-items: center;
            width: 100%;
            height: 100%;
            padding: 64px 72px;
          }
          .brand {
            display: block;
            margin-bottom: 36px;
          }
          .brand img {
            display: block;
            height: 56px;
            width: auto;
          }
          .dot, .accent { color: #0e7484; }
          .eyebrow {
            margin: 0 0 13px;
            color: #0e7484;
            font-size: 15px;
            font-weight: 800;
            letter-spacing: .16em;
            text-transform: uppercase;
          }
          h1 {
            max-width: 610px;
            margin: 0;
            font-size: 64px;
            line-height: .98;
            letter-spacing: -.055em;
          }
          .sub {
            max-width: 560px;
            margin: 24px 0 0;
            color: #5b6170;
            font-size: 22px;
            line-height: 1.45;
          }
          .proof {
            display: flex;
            gap: 12px;
            margin-top: 30px;
          }
          .proof span {
            padding: 9px 14px;
            border: 1px solid #e1e4e9;
            border-radius: 999px;
            background: rgba(255, 255, 255, .84);
            font-size: 14px;
            font-weight: 700;
          }
          .visual {
            position: relative;
            display: grid;
            place-items: center;
            height: 470px;
          }
          .halo {
            position: absolute;
            width: 390px;
            height: 390px;
            border-radius: 50%;
            background: rgba(14, 116, 132, .12);
            filter: blur(36px);
          }
          .photo {
            position: relative;
            width: 440px;
            height: 440px;
            object-fit: cover;
            border: 1px solid #e6e8ec;
            border-radius: 32px;
            background: #fff;
            box-shadow: 0 30px 70px rgba(11, 12, 15, .16);
          }
          .badge {
            position: absolute;
            right: -4px;
            bottom: 28px;
            padding: 14px 18px;
            border-radius: 16px;
            color: #fff;
            background: #0e7484;
            box-shadow: 0 16px 32px rgba(14, 116, 132, .28);
            font-size: 16px;
            font-weight: 800;
          }
        </style>
      </head>
      <body>
        <main>
          <section>
            <div class="brand"><img src="${logoUri}" alt="Afslank-injecties.nl" /></div>
            <p class="eyebrow">GLP-1 afvallen</p>
            <h1>Vial of <span class="accent">kant-en-klare pen.</span></h1>
            <p class="sub">Semaglutide, Tirzepatide en Retatrutide. Labgetest en discreet verzonden in NL en BE.</p>
            <div class="proof">
              <span>★ 4,8 uit 5</span>
              <span>1 – 2 werkdagen</span>
              <span>Gratis vanaf €100</span>
            </div>
          </section>
          <section class="visual">
            <div class="halo"></div>
            <img
              class="photo"
              src="${photoUri}"
              alt=""
            />
            <div class="badge">Meest gekozen pen</div>
          </section>
        </main>
      </body>
    </html>
  `);
  await page.locator(".photo").evaluate((image) => image.decode());
  await page.screenshot({
    path: fileURLToPath(new URL("../public/og.jpg", import.meta.url)),
    type: "jpeg",
    quality: 88,
  });
} finally {
  await browser.close();
}
