#!/usr/bin/env bash
#
# Meeras deployment script for AWS S3.
#
# Usage (own bucket / apex domain bucket — configures website + public read):
#   export BUCKET_NAME=meeras.example.com
#   export AWS_REGION=ap-southeast-2
#   ./deploy.sh
#
# Usage (subpath on an existing bucket — only uploads under a prefix; does not
# change bucket policy, public access, or website error/index documents):
#   export BUCKET_NAME=fareez.dev
#   export S3_PREFIX=meeras
#   export AWS_REGION=ap-southeast-2
#   ./deploy.sh
#
# Subdomain (e.g. meeras.fareez.dev): use a dedicated bucket name matching the
# subdomain and run without S3_PREFIX (DNS: CNAME/alias → S3 website endpoint).
#
# This script is idempotent — running it again after the bucket exists
# just re-uploads index.html and any other static files. The bucket
# policy and website configuration are re-applied each time, which is
# safe (except in S3_PREFIX mode, where bucket-level settings are left alone).

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────────────────
BUCKET_NAME="${BUCKET_NAME:-}"
AWS_REGION="${AWS_REGION:-ap-southeast-2}"
S3_PREFIX="${S3_PREFIX:-}"
S3_PREFIX="${S3_PREFIX#/}"
S3_PREFIX="${S3_PREFIX%/}"

if [[ -z "$BUCKET_NAME" ]]; then
  echo "✗ BUCKET_NAME environment variable is not set."
  echo
  echo "Run with:"
  echo "    export BUCKET_NAME=meeras.example.com"
  echo "    export AWS_REGION=ap-southeast-2     # or your preferred region"
  echo "    ./deploy.sh"
  echo
  echo "Subpath on existing bucket (does not replace apex site):"
  echo "    export BUCKET_NAME=fareez.dev"
  echo "    export S3_PREFIX=meeras"
  echo "    ./deploy.sh"
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "✗ AWS CLI not found. Install: https://aws.amazon.com/cli/"
  exit 1
fi

resolve_bucket_region() {
  local loc
  loc=$(aws s3api get-bucket-location --bucket "$1" --output text 2>/dev/null || true)
  if [[ -z "$loc" || "$loc" == "None" ]]; then
    echo "us-east-1"
  else
    echo "$loc"
  fi
}

PREFIX_MODE=0
if [[ -n "$S3_PREFIX" ]]; then
  PREFIX_MODE=1
fi

SYNC_DEST="s3://$BUCKET_NAME/"
if [[ "$PREFIX_MODE" -eq 1 ]]; then
  SYNC_DEST="s3://$BUCKET_NAME/$S3_PREFIX/"
fi

BUCKET_REGION="$(resolve_bucket_region "$BUCKET_NAME")"

echo "▸ Bucket:  $BUCKET_NAME"
echo "▸ Region:  $AWS_REGION  (API default)"
echo "▸ Bucket location:  $BUCKET_REGION  (website URL)"
if [[ "$PREFIX_MODE" -eq 1 ]]; then
  echo "▸ S3 prefix:  $S3_PREFIX/  (subpath deploy — bucket policy/website config unchanged)"
fi
echo

# ─── Step 1: create bucket if it doesn't exist ─────────────────────────────
if aws s3api head-bucket --bucket "$BUCKET_NAME" >/dev/null 2>&1; then
  echo "✓ Bucket already exists, skipping creation."
else
  if [[ "$PREFIX_MODE" -eq 1 ]]; then
    echo "✗ Bucket \"$BUCKET_NAME\" does not exist."
    echo "  Subpath deploy (S3_PREFIX) only uploads into an existing bucket."
    exit 1
  fi
  echo "▸ Creating bucket..."
  if [[ "$AWS_REGION" == "us-east-1" ]]; then
    # us-east-1 has a different create-bucket signature
    aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$AWS_REGION"
  else
    aws s3api create-bucket \
      --bucket "$BUCKET_NAME" \
      --region "$AWS_REGION" \
      --create-bucket-configuration LocationConstraint="$AWS_REGION"
  fi
  echo "✓ Bucket created."
fi

if [[ "$PREFIX_MODE" -eq 0 ]]; then
  # ─── Step 2: disable Block Public Access (required for website hosting) ────
  echo "▸ Disabling Block Public Access..."
  aws s3api put-public-access-block --bucket "$BUCKET_NAME" \
    --public-access-block-configuration '{
      "BlockPublicAcls": false,
      "IgnorePublicAcls": false,
      "BlockPublicPolicy": false,
      "RestrictPublicBuckets": false
    }'
  echo "✓ Block Public Access disabled."

  # ─── Step 3: apply public-read bucket policy ───────────────────────────────
  echo "▸ Applying bucket policy (public read)..."
  sed "s/BUCKET_NAME_PLACEHOLDER/$BUCKET_NAME/g" bucket-policy.json > /tmp/meeras-bucket-policy.json
  aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy file:///tmp/meeras-bucket-policy.json
  rm /tmp/meeras-bucket-policy.json
  echo "✓ Bucket policy applied."

  # ─── Step 4: enable static website hosting ─────────────────────────────────
  echo "▸ Enabling static website hosting..."
  aws s3 website "s3://$BUCKET_NAME/" \
    --index-document index.html \
    --error-document index.html
  echo "✓ Website hosting enabled (index document: index.html)."
else
  echo "▸ Skipping public access, bucket policy, and website config (S3_PREFIX mode)."
fi

# ─── Step 5: upload site files ─────────────────────────────────────────────
echo "▸ Uploading files to $SYNC_DEST ..."
aws s3 sync . "$SYNC_DEST" \
  --exclude "*.md" \
  --exclude "*.sh" \
  --exclude "*.json" \
  --exclude ".*" \
  --exclude "node_modules/*" \
  --exclude "*.docx" \
  --exclude "test.html" \
  --exclude "specimens/*" \
  --exclude "tests/*" \
  --exclude "build.js" \
  --exclude "wrangler.toml" \
  --exclude "dist/*" \
  --exclude "cloudfront/*" \
  --cache-control "max-age=300, public" \
  --delete
echo "✓ Files uploaded."

# ─── Step 6: print result ──────────────────────────────────────────────────
SITE_URL="http://$BUCKET_NAME.s3-website-$BUCKET_REGION.amazonaws.com"
if [[ "$PREFIX_MODE" -eq 1 ]]; then
  SITE_URL="${SITE_URL%/}/$S3_PREFIX/"
fi
echo
echo "════════════════════════════════════════════════════════════════════"
echo "✓ Deployment complete."
echo
echo "  Visit:  $SITE_URL"
echo
if [[ "$PREFIX_MODE" -eq 1 ]]; then
  echo "  Notes:"
  echo "  ─ For https://<your-domain>/$S3_PREFIX/ use CloudFront (or similar) to this S3 path."
  echo "  ─ S3 website HTTP endpoint above; custom domain HTTPS still uses CloudFront."
else
  echo "  Notes:"
  echo "  ─ This URL serves over HTTP only. For production, set up CloudFront."
  echo "  ─ See DEPLOYMENT.md → Part 3 for HTTPS + custom domain steps."
fi
echo "════════════════════════════════════════════════════════════════════"
