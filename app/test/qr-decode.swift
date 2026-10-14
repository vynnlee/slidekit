// macOS 전용 QR 디코드 검증: CoreImage의 QR 검출기로 lib/qr.ts가 만든 행렬을 실제로 읽는다. 사용: bun app/test/qr-verify.ts
import CoreImage
import CoreGraphics
import Foundation

let data = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let cases = (try! JSONSerialization.jsonObject(with: data)) as! [[String: Any]]
var failed = 0
for c in cases {
    let text = c["text"] as! String
    let rows = c["rows"] as! [String]
    let n = rows.count, scale = 8, quiet = 4, px = (n + quiet * 2) * scale
    let ctx = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    ctx.setFillColor(gray: 1, alpha: 1); ctx.fill(CGRect(x: 0, y: 0, width: px, height: px))
    ctx.setFillColor(gray: 0, alpha: 1)
    for (y, r) in rows.enumerated() { for (x, ch) in r.enumerated() where ch == "1" {
        ctx.fill(CGRect(x: (x + quiet) * scale, y: px - (y + quiet + 1) * scale, width: scale, height: scale))
    } }
    let img = CIImage(cgImage: ctx.makeImage()!)
    let det = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
    let got = (det.features(in: img).first as? CIQRCodeFeature)?.messageString
    let ok = got == text
    if !ok { failed += 1 }
    print("\(ok ? "PASS" : "FAIL") v\((n - 17) / 4) \(text.utf8.count) bytes")
}
exit(failed == 0 ? 0 : 1)
