// Render card.html to a square PNG with macOS's own WebKit (no browser needed).
//   swift render.swift <variant> <output.png>      variant: heart | coffee | domain | server
// The page is 800x800 CSS px; the snapshot is taken at 1600 px wide.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write("usage: swift render.swift <variant> <output.png>\n".data(using: .utf8)!); exit(2) }
let variant = args[1]
let output = URL(fileURLWithPath: args[2])
let dir = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
var page = URLComponents(url: dir.appendingPathComponent("card.html"), resolvingAgainstBaseURL: false)!
page.queryItems = [URLQueryItem(name: "v", value: variant)]

final class Renderer: NSObject, WKNavigationDelegate {
  let web: WKWebView
  let output: URL
  init(output: URL) {
    self.output = output
    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 800), configuration: WKWebViewConfiguration())
    super.init()
    web.navigationDelegate = self
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // Wait for the web fonts, then one more beat for layout and the logo image.
    webView.evaluateJavaScript("document.fonts.ready.then(function(){return document.fonts.size})") { _, _ in
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { self.snapshot() }
    }
  }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("\(error)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("\(error)") }
  func fail(_ message: String) { FileHandle.standardError.write((message + "\n").data(using: .utf8)!); exit(1) }
  func snapshot() {
    let cfg = WKSnapshotConfiguration()
    cfg.rect = NSRect(x: 0, y: 0, width: 800, height: 800)
    cfg.snapshotWidth = 1600
    web.takeSnapshot(with: cfg) { image, error in
      guard let image = image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
            let png = rep.representation(using: .png, properties: [:]) else { self.fail("snapshot failed: \(String(describing: error))"); return }
      do { try png.write(to: self.output) } catch { self.fail("\(error)") }
      print("  \(self.output.lastPathComponent)  \(rep.pixelsWide)x\(rep.pixelsHigh)")
      exit(0)
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let renderer = Renderer(output: output)
renderer.web.loadFileURL(page.url!, allowingReadAccessTo: dir.deletingLastPathComponent())
DispatchQueue.main.asyncAfter(deadline: .now() + 40) { renderer.fail("timed out") }
app.run()
