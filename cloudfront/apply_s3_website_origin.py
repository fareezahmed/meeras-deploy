#!/usr/bin/env python3
"""
Reconfigure a CloudFront distribution so an origin uses the S3 *static website*
hostname (custom origin, HTTP), instead of the S3 REST API bucket endpoint.

Why: S3 website hosting maps /prefix/ to /prefix/index.html. The REST API does
not, so /meeras/ returns 403 when objects live at meeras/index.html.

This script also clears CloudFront Function associations on the default cache
behavior (removes viewer-request functions that may be redundant or broken).

Usage:
  python3 cloudfront/apply_s3_website_origin.py \\
    --distribution-id E3BVH5HH4S1R5R \\
    --origin-id fareez.dev.s3-website-ap-southeast-2.amazonaws.com \\
    --website-host fareez.dev.s3-website-ap-southeast-2.amazonaws.com \\
    --profile default

Then wait for the distribution status Deployed and optionally invalidate /*.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys


def aws_json(profile: str, *args: str) -> dict:
    cmd = ["aws", *args, "--profile", profile, "--output", "json"]
    out = subprocess.check_output(cmd, text=True)
    return json.loads(out)


def aws_run(profile: str, *args: str) -> None:
    cmd = ["aws", *args, "--profile", profile]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(r.stderr or r.stdout or "")
        sys.stderr.write("\n")
        raise SystemExit(r.returncode)


def website_origin_item(origin_id: str, website_host: str) -> dict:
    return {
        "Id": origin_id,
        "DomainName": website_host,
        "OriginPath": "",
        "CustomHeaders": {"Quantity": 0},
        "CustomOriginConfig": {
            "HTTPPort": 80,
            "HTTPSPort": 443,
            "OriginProtocolPolicy": "http-only",
            "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
            "OriginReadTimeout": 30,
            "OriginKeepaliveTimeout": 5,
        },
        "ConnectionAttempts": 3,
        "ConnectionTimeout": 10,
        "OriginShield": {"Enabled": False},
        "OriginAccessControlId": "",
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--distribution-id", required=True)
    p.add_argument(
        "--origin-id",
        required=True,
        help="Existing origin Id to replace (keeps TargetOriginId if it matches).",
    )
    p.add_argument(
        "--website-host",
        required=True,
        help="S3 website endpoint host, e.g. mybucket.s3-website-ap-southeast-2.amazonaws.com",
    )
    p.add_argument("--profile", default="default")
    args = p.parse_args()

    raw = aws_json(
        args.profile,
        "cloudfront",
        "get-distribution-config",
        "--id",
        args.distribution_id,
    )
    etag = raw["ETag"]
    cfg = raw["DistributionConfig"]

    items = cfg["Origins"]["Items"]
    idx = next((i for i, o in enumerate(items) if o["Id"] == args.origin_id), None)
    if idx is None:
        ids = [o["Id"] for o in items]
        print(f"No origin with Id={args.origin_id!r}. Found: {ids}", file=sys.stderr)
        raise SystemExit(1)

    items[idx] = website_origin_item(args.origin_id, args.website_host)
    cfg["Origins"] = {"Quantity": len(items), "Items": items}

    dcb = cfg["DefaultCacheBehavior"]
    dcb["FunctionAssociations"] = {"Quantity": 0, "Items": []}

    path = "/tmp/cloudfront-website-origin-config.json"
    with open(path, "w") as f:
        json.dump(cfg, f)

    aws_run(
        args.profile,
        "cloudfront",
        "update-distribution",
        "--id",
        args.distribution_id,
        "--if-match",
        etag,
        "--distribution-config",
        f"file://{path}",
    )
    print("Update submitted. Wait until status is Deployed, then test /meeras/ and invalidate if needed:")
    print(
        f"  aws cloudfront create-invalidation --distribution-id {args.distribution_id} "
        f'--paths "/*" --profile {args.profile}'
    )


if __name__ == "__main__":
    main()
