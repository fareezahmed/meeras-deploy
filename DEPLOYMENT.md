# Meeras — Detailed Deployment Guide

This document walks through every step to deploy Meeras to AWS S3, with and
without CloudFront/custom-domain. If you just want the short version, read
the **Quick deploy** section in `README.md` first.

---

## Part 1 — Prerequisites

### 1.1 AWS account

If you don't already have one, sign up at https://aws.amazon.com.
The first 12 months include a free tier that covers everything in this guide
for a small community deployment.

### 1.2 IAM user with deployment permissions

**Do not use your AWS root account for deployments.** Create a dedicated IAM user:

1. IAM Console → Users → "Create user" → call it `meeras-deploy`
2. Attach policies: `AmazonS3FullAccess`, `CloudFrontFullAccess`, `Route53FullAccess`
   (for tighter security, you can scope these down later — start broad to get
    things working)
3. Security credentials tab → "Create access key" → choose "CLI" → save the
   Access Key ID and Secret Access Key somewhere safe (you'll only see the
   secret once)

### 1.3 AWS CLI

```bash
# macOS
brew install awscli

# Ubuntu / Debian
sudo apt-get install awscli

# Windows
# Download installer from https://aws.amazon.com/cli/

# Verify
aws --version
```

Configure it with the IAM user's credentials:

```bash
aws configure
# AWS Access Key ID:     <paste from step 1.2>
# AWS Secret Access Key: <paste from step 1.2>
# Default region name:   ap-southeast-2          (or your preferred region)
# Default output format: json
```

### 1.4 Pick a bucket name

S3 bucket names are **globally unique** across all AWS accounts. The cleanest
choice is your eventual domain name, e.g. `meeras.example.com` or
`meeras-app-prod`. Names must be lowercase, no underscores.

---

## Part 2 — Simple deployment (S3 website hosting, HTTP only)

This gets you live in 10 minutes but uses HTTP only. Suitable for staging and
testing. **For production, use Part 3 (CloudFront).**

### 2.1 Update Stripe links in `donation-config.js`

Open **`donation-config.js`** next to `index.html`. It sets
`window.MEERAS_DONATION`; paste your Stripe Payment Link URLs into `links`
and keep `enabled: true` (or set `enabled: false` to hide the donation step).
Redeploy so both `index.html` and `donation-config.js` are uploaded.

### 2.2 Run the deploy script

```bash
export BUCKET_NAME=meeras-yourname-app
export AWS_REGION=ap-southeast-2
chmod +x deploy.sh
./deploy.sh
```

The script does all of the following:

```bash
# Create the bucket
aws s3 mb s3://$BUCKET_NAME --region $AWS_REGION

# Disable the default "block public access" guard (required for website hosting)
aws s3api put-public-access-block --bucket $BUCKET_NAME \
  --public-access-block-configuration '{
    "BlockPublicAcls": false,
    "IgnorePublicAcls": false,
    "BlockPublicPolicy": false,
    "RestrictPublicBuckets": false
  }'

# Apply the public-read bucket policy
aws s3api put-bucket-policy --bucket $BUCKET_NAME --policy file://bucket-policy.json

# Enable static website hosting
aws s3 website s3://$BUCKET_NAME/ \
  --index-document index.html \
  --error-document index.html

# Upload index.html and supporting files
aws s3 sync . s3://$BUCKET_NAME/ \
  --exclude "*.md" \
  --exclude "*.sh" \
  --exclude "*.json" \
  --exclude ".*"

# Print the URL
echo "Site available at:"
echo "http://$BUCKET_NAME.s3-website-$AWS_REGION.amazonaws.com"
```

### 2.3 Test

Open the printed URL in a browser. The Meeras landing page should appear.
Try creating a draft, navigating between screens, generating a sample PDF.

---

## Part 3 — Production deployment (S3 + CloudFront + HTTPS + custom domain)

This adds:
- **HTTPS** via CloudFront and AWS Certificate Manager (ACM)
- **CDN** for fast loads worldwide
- **Custom domain** like `meeras.org` or `will.yourname.com`
- **Better security** — S3 bucket can be made fully private with CloudFront
  origin access (OAC)

### 3.1 Complete Part 2 first

You need a working S3 bucket. Do Part 2 if you haven't.

### 3.2 Request an SSL certificate (must be us-east-1)

CloudFront only accepts ACM certificates from **us-east-1**, regardless of
where your bucket lives.

```bash
aws acm request-certificate \
  --domain-name meeras.yourdomain.com \
  --subject-alternative-names www.meeras.yourdomain.com \
  --validation-method DNS \
  --region us-east-1
```

The command returns a `CertificateArn`. Copy it.

Then list the validation records:

```bash
aws acm describe-certificate \
  --certificate-arn <paste-cert-arn> \
  --region us-east-1 \
  --query 'Certificate.DomainValidationOptions[*].ResourceRecord'
```

Add the returned `CNAME` records to your DNS (Route 53 or your registrar's
DNS panel). Wait 5–30 minutes; the certificate status will change to `ISSUED`.

### 3.3 Create the CloudFront distribution

Edit `cloudfront-config.json` to replace placeholders:

- `<BUCKET_NAME>` → your bucket name from Part 2
- `<AWS_REGION>` → the region the bucket is in
- `<CERTIFICATE_ARN>` → the ARN from step 3.2
- `<DOMAIN_NAME>` → your domain, e.g. `meeras.yourdomain.com`

Then create the distribution:

```bash
aws cloudfront create-distribution --distribution-config file://cloudfront-config.json
```

This returns a CloudFront domain like `d1234abcdef.cloudfront.net`. Save the
`Id` field — that's your distribution ID, used for cache invalidations later.

CloudFront takes ~15-20 minutes to fully propagate the first time.

### 3.3a Subpath hosting (`/meeras/`) and CloudFront origins

If Meeras lives under a **prefix** in the bucket (for example `s3://fareez.dev/meeras/index.html`) and viewers use **`https://your-domain/meeras/`**, the origin must behave like **S3 static website hosting**:

- **S3 REST API origin** (bucket hostname `bucket.s3.region.amazonaws.com` with OAI/OAC): there is **no** automatic `index.html` for subfolders. `/meeras/` often returns **403** even when `meeras/index.html` exists.
- **S3 website endpoint** (`bucket.s3-website-region.amazonaws.com`): **does** map `/meeras/` to `meeras/index.html`.

**Recommended fix:** point CloudFront at the **website hostname** as a **custom origin** (HTTP only to port 80), not as an S3 origin with OAI. Your bucket must allow public reads for the website endpoint (same as Part 2). You lose OAI-only “private bucket” for that origin until you redesign (for example Lambda@Edge or a dedicated subdomain bucket).

Helper script (replaces the matching origin, clears viewer-request **CloudFront Function** associations on the default cache behavior):

```bash
python3 cloudfront/apply_s3_website_origin.py \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --origin-id YOUR_EXISTING_ORIGIN_ID \
  --website-host YOUR_BUCKET.s3-website-REGION.amazonaws.com \
  --profile default
```

Wait until the distribution status is **Deployed**, then test `https://your-domain/meeras/` and run a cache invalidation if needed (`/*`).

### 3.4 Configure SPA fallback (custom error responses)

Because Meeras is a single-page app, any unknown path (like someone typing
`/contact` directly) should still serve `index.html`. In the CloudFront
console:

1. Open your distribution → **Error pages** tab
2. **Create custom error response:**
   - HTTP error code: **403: Forbidden**
   - Customize error response: **Yes**
   - Response page path: **/index.html**
   - HTTP response code: **200: OK**
3. **Repeat for 404: Not Found**

The provided `cloudfront-config.json` already includes these.

### 3.5 Point your DNS at CloudFront

In Route 53 (or your DNS provider), create:

- A CNAME record: `meeras` → `d1234abcdef.cloudfront.net`
- (Or, if using Route 53 with the apex: an ALIAS A record to the distribution)

After DNS propagates (5–60 minutes), https://meeras.yourdomain.com will
serve the site over HTTPS via CloudFront.

### 3.6 (Recommended) Tighten the S3 bucket using OAC

Right now your S3 bucket is publicly readable. With CloudFront in place, you
can make the bucket **fully private** and only allow CloudFront to read from
it, using Origin Access Control (OAC). See the AWS docs:
https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html

This is a slight security improvement: it prevents anyone from bypassing
CloudFront and hitting the bucket directly.

---

## Part 4 — Updating after deployment

To deploy a new version of `index.html`, `donation-config.js`, or other static files:

```bash
# Just run the deploy script again — it handles re-uploads
./deploy.sh

# If using CloudFront, invalidate the cache so users see the new version immediately
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

The first 1,000 invalidation paths per month are free; beyond that they're
$0.005 each.

---

## Part 5 — Security headers (recommended)

For a production deployment, add these response headers via a CloudFront
Response Headers Policy:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.stripe.com
```

Note: `'unsafe-inline'` is necessary because the app keeps all CSS and JS
inline in `index.html`. If you want strict CSP, you'd need to extract them
to separate files — but the inline approach is intentional for simplicity
and offline-readability.

To apply:

1. CloudFront Console → **Policies** → **Response headers** → **Create response headers policy**
2. Add each header above as a custom header
3. Back in your distribution → Behaviors tab → Edit the default behavior →
   set "Response headers policy" to the one you just created

---

## Part 6 — Advanced: self-hosting fonts and pdf-lib

If you want zero external requests for privacy reasons (some users on slow
connections or in restricted networks may have issues with cdnjs/Google):

1. Download Google Fonts via google-webfonts-helper:
   https://gwfh.mranftl.com/fonts
   — pick Cormorant Garamond, Inter, Amiri. Download the zip.

2. Download pdf-lib:
   https://github.com/Hopding/pdf-lib/releases — `pdf-lib.min.js`

3. Place them under `/fonts/` and `/lib/pdf-lib.min.js` in your deployment dir.

4. Edit `index.html`:
   - Replace the `<link href="https://fonts.googleapis.com/...">` block with
     `@font-face` rules pointing to the local font files
   - Find `'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'`
     and replace with `'/lib/pdf-lib.min.js'`

5. Re-upload.

This is optional. The defaults work fine for most deployments.

---

## Part 7 — Troubleshooting

**"Access Denied" when visiting the S3 website URL**
- Re-check the bucket policy applied correctly: `aws s3api get-bucket-policy --bucket $BUCKET_NAME`
- Confirm "Block public access" is disabled: S3 Console → bucket → Permissions tab

**CloudFront returns "Origin DNS error"**
- The S3 website endpoint format is different from the bucket endpoint:
  use `<BUCKET>.s3-website-<REGION>.amazonaws.com` as the origin (no
  https://, no leading slash). The provided `cloudfront-config.json` handles this.

**Stripe buttons do nothing**
- Confirm **`donation-config.js`** is deployed next to `index.html` (same S3 prefix / folder).
- In `donation-config.js`, check `enabled` is not `false` and at least one `links.*` value is a full `https://buy.stripe.com/...` URL. Open the browser Network tab and verify `donation-config.js` returns 200 (not 404).

**Drafts don't persist after you close the tab**
- By default Meeras uses **sessionStorage**: drafts exist only for that tab.
  Closing the tab clears them. Use **Manage drafts → Export to file** to keep a
  copy. For saves across tab closes on the same device, set
  `MEERAS_USE_INDEXEDDB = true` in the app script in `index.html` (advanced).
  Check the browser developer console for `[Meeras] Storage ready` logs if you need to debug storage.

**Drafts missing when IndexedDB mode is off**
- Old data may still exist in IndexedDB from a previous version but is not read
  unless `MEERAS_USE_INDEXEDDB` is enabled.

**ACM certificate stuck on "Pending validation"**
- The CNAME records must be added exactly as shown (including the trailing
  dot in Route 53). Run `dig CNAME <validation-name>` to confirm DNS resolution.

---

## Part 8 — Production on Cloudflare (meeras.com.au)

Meeras has two environments built from the same files:

| Environment | URL | Host | Deploy |
|---|---|---|---|
| **Dev** | https://fareez.dev/meeras/ | AWS S3 + CloudFront (Parts 2–3 above) | `./deploy.sh` with `BUCKET_NAME=fareez.dev S3_PREFIX=meeras` |
| **Production** | https://meeras.com.au | Cloudflare Worker with static assets, project `meeras-deploy` (this part) | `git push` to `main` (Workers Builds) or `npm run deploy:prod` |

`node build.js` assembles `dist/` for one environment. The only differences
between the two builds are the Umami analytics tag (`data-domains`, and the
Umami website id for production) and, in production, a `<link rel="canonical">`
pointing at `https://meeras.com.au/` plus Cloudflare's `_headers` (security and
cache headers). No Will clause text changes, so
the MD5 pinned in the legal-review document refers to the repository
`index.html`, not to `dist/index.html`.

### 8.1 One-time setup (about 15 minutes)

1. **Umami:** in https://analytics.fareez.dev add a second website,
   `meeras.com.au`, and copy its website id. Keeping production and dev as
   separate Umami websites keeps the dashboards separate. (If you prefer one
   combined dashboard, skip this: the build falls back to the shared id, and
   `data-domains` already lists both hosts.)
2. **The Worker project (Git integration):** Cloudflare dashboard → Workers &
   Pages → Create → *Import a repository* → `fareezahmed/meeras-deploy`. The
   project is named `meeras-deploy` (it must match `name` in `wrangler.toml`).
   In *Settings → Build*:
   - Production branch: `main`
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy` (the default)
   - Build variable: `UMAMI_WEBSITE_ID` = the id from step 1
   `wrangler.toml` declares `[assets] directory = "./dist"`, so the deploy
   uploads `dist/` as static assets with no Worker script. Every push to `main`
   deploys production; other branches build preview versions.
3. **Custom domains:** in the project → *Settings → Domains & Routes → Add →
   Custom domain* → `meeras.com.au`, then again for `www.meeras.com.au`.
   Because the zone is already on Cloudflare, the DNS records are created for
   you and the certificate is issued automatically (a few minutes). Both
   hostnames serve the site; the canonical link points search engines at the
   apex. To redirect `www` to the apex as well, add a zone Redirect Rule:
   Cloudflare dashboard → `meeras.com.au` → Rules → Redirect Rules → the
   "Redirect from WWW to Root" template (Workers static assets cannot host
   a hostname redirect in `_redirects`). The `*.workers.dev` URL can stay
   disabled.
4. **Check:** open https://meeras.com.au, generate the sample PDF, confirm the
   donation buttons open Stripe, and look for the production hostname in the
   Umami dashboard. `curl -sI https://meeras.com.au | grep -i content-security`
   should show the CSP from `_headers`.

### 8.2 Alternative: deploy from this machine (direct upload)

```bash
npx --yes wrangler login        # once; opens the browser
npm run deploy:prod             # runs the tests, builds dist/, uploads
```

This deploys to the same Worker (`meeras-deploy`) as the Git integration.
Custom domains are still attached in the dashboard (step 3 above).

### 8.3 Day to day

- Dev first, then production: `./deploy.sh` (dev on AWS) → review at
  https://fareez.dev/meeras/ → `git push` (or `npm run deploy:prod`).
- Rollback: every deployment is kept; *Deployments* → pick an earlier version
  → *Rollback*.
- The content-security policy in `_headers` allows exactly what the app loads:
  Google Fonts, pdf-lib from cdnjs, the self-hosted Umami script, and
  inline CSS/JS. If a future change loads something new, add it there or the
  browser will block it in production only.
- Search engines: production carries the canonical link. If the dev copy ever
  shows up in search results, add `<meta name="robots" content="noindex">` to
  the dev build in `build.js`.

---

## Need to back out?

To completely remove the deployment:

```bash
aws s3 rm s3://$BUCKET_NAME --recursive
aws s3 rb s3://$BUCKET_NAME
# (and disable / delete the CloudFront distribution from the console)
```

No charges accrue once the bucket and distribution are gone.

---

May Allah make this beneficial. — Meeras
