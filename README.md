# Meeras — Deployment Package

A free, static, Shariah-compliant Islamic Will generator for Australian Muslim families.
This package contains everything needed to deploy Meeras to AWS S3 (with optional
CloudFront for HTTPS and a custom domain).

---

## What's in this package

```
meeras-deploy/
├── index.html              ← The entire application (single-file SPA, ~280 KB)
├── donation-config.js      ← Stripe Payment Link URLs (optional donations)
├── README.md               ← This file
├── DEPLOYMENT.md           ← Detailed step-by-step deployment guide
├── MANUAL_TEST_PLAN.md     ← Manual test scenarios & sign-off checklist
├── bucket-policy.json      ← S3 bucket policy template
├── cloudfront-config.json  ← CloudFront distribution template (optional)
├── cloudfront/             ← apply_s3_website_origin.py (REST vs website origin)
├── deploy.sh               ← One-command AWS CLI deploy script
├── 404.html                ← Fallback page that redirects to the SPA
├── robots.txt              ← Search-engine indexing rules
├── assets/logo/            ← Web logo files: header/footer PNG+WebP, favicons, og-image.jpg, pdf-logo.jpg (deployed)
├── brand/                  ← Logo sources (AI, EPS, PDF, master PNG/JPG); not deployed
├── build.js                ← Assembles dist/ per environment (npm run build; see DEPLOYMENT.md Part 8)
├── wrangler.toml           ← Cloudflare Worker for production (meeras.com.au) and staging
├── worker/index.mjs        ← Member API on /api/*: email sign-in, encrypted vault, Stripe membership, consultation requests
├── migrations/             ← D1 database schema for the member API (DEPLOYMENT.md Part 9)
├── test.html               ← Browser tests for the inheritance engine (serve, then open)
├── tests/faraid-engine.test.js ← Node tests + cross-check against Al-Mawārīth (npm test)
├── package.json            ← `npm test` only; no dependencies
├── specimens/              ← Seven specimen Wills (fictional names) for the legal review
└── .gitignore              ← Standard ignores if you put this in version control
```

The entire application is **one HTML file** plus a small **`donation-config.js`**
for Stripe links (loaded first). No build step, no bundler, no framework
installation. CSS and JavaScript are inline in `index.html`. The only external dependencies fetched
at runtime are Google Fonts and `pdf-lib` from cdnjs (both via HTTPS).

**Manual QA:** see **`MANUAL_TEST_PLAN.md`** for step-by-step scenarios and a smoke sign-off checklist.

---

## Before you deploy

### 1. Edit Stripe donation links in `donation-config.js`

Open **`donation-config.js`** in this folder (it is loaded before the main app
script in `index.html`). Paste your Stripe **Payment Link** URLs
(`https://buy.stripe.com/...`) into `links.amount5`, `amount15`, `amount50`,
and/or `custom` (leave any tier you do not offer as `''`). The donation screen
appears when at least one link is a valid `https://` Stripe URL. Set
`enabled: false` in that file if you want to hide the panel even when links
exist.

`index.html` contains a small `DONATION_CONFIG` default plus a merge step; you
normally only edit **`donation-config.js`**. Deploy that file next to
`index.html` (the included `deploy.sh` already uploads `*.js`).

```javascript
window.MEERAS_DONATION = {
  enabled: true,
  currency: 'AUD',
  links: {
    amount5:  'https://buy.stripe.com/<your-A$5-link>',
    amount15: 'https://buy.stripe.com/<your-A$15-link>',
    amount50: 'https://buy.stripe.com/<your-A$50-link>',
    custom:   'https://buy.stripe.com/<your-custom-amount-link>',
  },
  successUrl: origin,
};
```

You can instead set `window.MEERAS_DONATION` from another script **before** the
main bundle if you inject config at deploy time.

If you haven't created Payment Links yet, see the **"Stripe setup"** section
at the bottom of this file.

### 2. Test locally

Before uploading anywhere, verify the file works:

```bash
# Python (almost every machine has this)
python3 -m http.server 8000

# Or Node.js
npx serve .
```

Open `http://localhost:8000/index.html` and click through the wizard. If
donations are configured, the Stripe buttons should open `buy.stripe.com`
in a new tab.

---

## Quick deploy (S3 website hosting only, HTTP, ~10 minutes)

**Prerequisites:**
- AWS account
- AWS CLI installed (`aws --version` should print a version)
- AWS CLI configured (`aws configure` once, with an IAM user that has S3 permissions)

**Deploy:**

```bash
# 1. Pick a bucket name (must be globally unique; we recommend your domain)
export BUCKET_NAME=meeras.example.com
export AWS_REGION=ap-southeast-2

# 2. Run the deploy script
chmod +x deploy.sh
./deploy.sh
```

The script creates the bucket, enables website hosting, sets the public-read
policy, and uploads `index.html`. When done, it prints the website URL —
something like:

```
http://meeras.example.com.s3-website-ap-southeast-2.amazonaws.com
```

This URL is **HTTP only**. For HTTPS (and a clean custom domain), continue
to the production setup in `DEPLOYMENT.md`.

---

## Environments

- **Production:** https://meeras.com.au on a Cloudflare Worker (static assets,
  project `meeras-deploy`), deployed on every push to `main` (or
  `npm run deploy:prod`). Setup in `DEPLOYMENT.md` Part 8.
- **Dev:** https://fareez.dev/meeras/ on AWS S3 + CloudFront, deployed with
  `./deploy.sh` (the sections below).

Both are built from the same `index.html`; `node build.js` only swaps the
analytics tag and adds the production canonical link and headers.

## Dev deploy on AWS (S3 + CloudFront + HTTPS + custom domain)

See `DEPLOYMENT.md` for the full walkthrough. The short version:

1. Use the quick deploy above to get the S3 bucket created and the file uploaded.
2. Request an SSL certificate via AWS Certificate Manager (**must be in us-east-1**).
3. Create a CloudFront distribution pointing at the S3 bucket.
4. Configure the custom error response (403/404 → `/index.html`, status 200).
5. Update your DNS (Route 53 or external) to point at the CloudFront distribution.

Time required: ~30-60 minutes (most of it waiting for ACM certificate validation
and CloudFront propagation).

---

## Costs

Realistic monthly costs for a small-to-moderate community deployment:

| Setup | Storage | Bandwidth | DNS | Total |
|---|---|---|---|---|
| S3 only | ~$0.01 | $0.09/GB | $0 | **~A$0.10–$2/mo** |
| S3 + CloudFront | ~$0.01 | $0.085/GB | $0 | **~A$0.10–$3/mo** |
| S3 + CloudFront + Route 53 custom domain | ~$0.01 | $0.085/GB | $0.50/hosted zone | **~A$1–$5/mo** |

The first 12 months of an AWS account include a free tier covering most of this.
After that, even moderate community use (1,000 visitors/month, ~280 KB per visit
≈ 280 MB transfer) costs cents.

---

## Updating after deployment

To push a new version:

```bash
# Re-upload (the deploy.sh script handles this if the bucket already exists)
./deploy.sh

# If you're using CloudFront, also invalidate the cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

CloudFront invalidations for the first 1,000 paths each month are free.

---

## Inheritance engine, school of fiqh, and tests

The farāʾiḍ engine is `calculateFaraid(rules)` in `index.html` (section 3). It is
kept in step with the Al-Mawārīth calculator's `calcSunni`, the reference engine,
for every family the Meeras heir model can express: spouses, sons, daughters,
parents, paternal grandfather, both grandmothers, full brothers and sisters.

Where the four Sunni schools differ, `rulesForMadhhab(id)` supplies the ruling
(`{ madhhab, pgmWithFather, jaddMuqasama, raddToHeirs: true, distantKindred: true }`):

| Family | No school selected | Ḥanafī | Mālikī, Shāfiʿī | Ḥanbalī |
|---|---|---|---|---|
| Paternal grandmother beside the father (mother absent) | takes 1/6 | excluded by the father | excluded by the father | takes 1/6 |
| Grandfather beside full brothers and sisters (father absent, no son) | Zayd ibn Thābit's method | excludes them | Zayd's method | Zayd's method |

Zayd ibn Thābit's method: with no other fixed-share heir the grandfather takes
the better of sharing as a brother (two heads to a sister's one) and one third
of the estate; with other fixed-share heirs, the best of sharing in the
remainder, one third of the remainder and one sixth of the estate, never less
than a sixth. Sisters beside him take no fixed share. Al-Akdariyyah (husband,
mother, grandfather, one full sister) gives husband 1/3, mother 2/9, grandfather
8/27, sister 4/27. Meeras has no paternal half-siblings, so muʿādda never arises.

Radd (the surplus when the fixed shares do not exhaust the estate and no
residuary survives) goes to the Quranic heirs excluding the spouse in every
school: the Ḥanafī and Ḥanbalī position and the later fatwā of the Mālikī and
Shāfiʿī schools. Distant kindred (dhawū al-arḥām) inherit only when no Quranic
heir and no residuary relative survives, in all four schools; Meeras does not
compute their shares and refers the family to a scholar.

The **School of fiqh** selector sits at the top of the heirs step (S13) and is
remembered in `localStorage` under `meeras:madhhab`, so starting a new Will keeps
it. Two optional per-ruling choices appear only when relevant, under the paternal
grandmother (father alive, mother not) and under the paternal grandfather (father
absent, no son); they are pre-set from the school, say so, and are stored in the
draft as `heirs.rulings`. The results screen, the summary and the PDF name the
school only when one was selected ("following the Shāfiʿī school").

### Running the tests

```bash
npm test          # = node tests/faraid-engine.test.js, no dependencies
```

The script slices the engine out of `index.html`, runs the worked examples
(al-Akdariyyah, Zayd's method, ʿUmariyyatān, sisters with and without daughters,
radd, the charity fallback), sweeps 5,000 random families under the default and
Ḥanafī rules (every distribution must sum to exactly one with no negative share)
and, when `../mawarith/Mawarith-Calculator.html` exists (or `MAWARITH=path` is
set), asserts that every heir's fraction equals Al-Mawārīth's for all of them.
Browser tests: serve the folder (`python3 -m http.server 8000`) and open
`http://localhost:8000/test.html`.

---

## Privacy & security notes

Meeras is designed to protect users' will data:

- **All data stays on the user's device.** By default drafts live in
  **sessionStorage** for that browser tab only (closing the tab clears them).
  Set `MEERAS_USE_INDEXEDDB = true` in `index.html` for IndexedDB persistence
  across sessions on the same device. Artifact environments may use
  `window.storage` instead. The application never transmits will data anywhere.
- **External requests:** the page loads Google Fonts and `pdf-lib` from
  cdnjs at first visit. Both are served over HTTPS, but if you have strict
  privacy requirements you may want to self-host these (see "Advanced:
  self-hosting fonts" in `DEPLOYMENT.md`).
- **HTTPS is strongly recommended for production.** Sensitive form data
  shouldn't traverse plain HTTP. Use the CloudFront route, not the bare
  S3 website endpoint, for any public deployment.

---

## Stripe setup (if you haven't done this yet)

1. **Sign up at https://stripe.com** with your business or sole-trader details.
2. **Activate your account** (Stripe will verify your identity and bank account).
3. **Dashboard → Payment Links → "+ New"** and create four links:

   | Product name | Pricing |
   |---|---|
   | Meeras contribution — A$5 | Standard pricing, AUD 5.00 |
   | Meeras contribution — A$15 | Standard pricing, AUD 15.00 |
   | Meeras contribution — A$50 | Standard pricing, AUD 50.00 |
   | Meeras contribution (custom amount) | "Customer chooses price", min AUD 1.00 |

   For each: turn off "Collect customer address" to keep the donation flow short.

4. **Copy each `https://buy.stripe.com/...` URL** into `index.html` as shown above.

**Important:** Meeras is not a registered charity or DGR. Contributions are
not tax-deductible. Make sure your Stripe product descriptions match this
honest framing (the in-app copy already does).

---

## Need help?

- AWS S3 documentation: https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteHosting.html
- AWS CloudFront documentation: https://docs.aws.amazon.com/AmazonCloudFront/
- Stripe Payment Links: https://stripe.com/docs/payment-links

May Allah accept your effort in maintaining a beneficial platform for the
Muslim community.

— Meeras
