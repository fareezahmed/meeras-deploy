// Render one layout of promo.html to a PNG with macOS's own WebKit, or make a QR code.
//   render-promo page <variant> <css-width> <css-height> <output.png>
//   render-promo qr   <text> <output.png>
// The snapshot is taken at the CSS width; on a 2x display the PNG is twice that in pixels,
// and render.sh resizes it to the size it wants.
import AppKit
import WebKit
import CoreImage

func fail(_ message: String) -> Never { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }
func writePNG(_ rep: NSBitmapImageRep, to url: URL) {
  guard let png = rep.representation(using: .png, properties: [:]) else { fail("could not encode PNG") }
  do { try png.write(to: url) } catch { fail("\(error)") }
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: render-promo page <variant> <w> <h> <out.png> | qr <text> <out.png>") }

if args[1] == "qr" {
  guard args.count == 4 else { fail("usage: render-promo qr <text> <out.png>") }
  guard let filter = CIFilter(name: "CIQRCodeGenerator") else { fail("no QR generator") }
  filter.setValue(args[2].data(using: .utf8), forKey: "inputMessage")
  filter.setValue("M", forKey: "inputCorrectionLevel")
  guard let small = filter.outputImage else { fail("QR failed") }
  let scale: CGFloat = 20   // each module becomes 20 x 20 px, sharp at print size
  let big = small.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
  let ctx = CIContext(options: [.useSoftwareRenderer: true])
  guard let cg = ctx.createCGImage(big, from: big.extent) else { fail("QR render failed") }
  writePNG(NSBitmapImageRep(cgImage: cg), to: URL(fileURLWithPath: args[3]))
  print("  \(URL(fileURLWithPath: args[3]).lastPathComponent)  \(cg.width)x\(cg.height)")
  exit(0)
}

guard args[1] == "page", args.count == 6, let w = Double(args[3]), let h = Double(args[4]) else {
  fail("usage: render-promo page <variant> <w> <h> <out.png>")
}
let variant = args[2]
let output = URL(fileURLWithPath: args[5])
let dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
var page = URLComponents(url: dir.appendingPathComponent("promo.html"), resolvingAgainstBaseURL: false)!
page.queryItems = [URLQueryItem(name: "v", value: variant)]

final class Renderer: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let output: URL
  let size: NSSize
  init(output: URL, size: NSSize) {
    self.output = output
    self.size = size
    web = WKWebView(frame: NSRect(origin: .zero, size: size), configuration: WKWebViewConfiguration())
    super.init()
    web.navigationDelegate = self
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Wait for the web fonts, then one more beat for layout and the logo images.
    webView.evaluateJavaScript("document.fonts.ready.then(function(){return document.fonts.size})") { _, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { self.snapshot() }
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("\(error)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("\(error)") }
  func snapshot() {
    let cfg = WKSnapshotConfiguration()
    cfg.rect = NSRect(origin: .zero, size: size)
    cfg.snapshotWidth = NSNumber(value: Double(size.width))
    web.takeSnapshot(with: cfg) { image, error in
      guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) else {
        fail("snapshot failed: \(String(describing: error))")
      }
      writePNG(rep, to: self.output)
      print("  \(self.output.lastPathComponent)  \(rep.pixelsWide)x\(rep.pixelsHigh)")
      exit(0)
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let renderer = Renderer(output: output, size: NSSize(width: w, height: h))
renderer.web.loadFileURL(page.url!, allowingReadAccessTo: dir)
DispatchQueue.main.asyncAfter(deadline: .now() + 45) { fail("timed out") }
app.run()
