// Example only — not wired by default. CloudFront Functions can rewrite
// /meeras/ -> /meeras/index.html when the origin is the S3 REST API.
// Prefer: point CloudFront at the S3 *website* endpoint instead; see
// ../apply_s3_website_origin.py and DEPLOYMENT.md §3.3a.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri == "/meeras" || uri == "/meeras/") {
    request.uri = "/meeras/index.html";
  }
  return request;
}
