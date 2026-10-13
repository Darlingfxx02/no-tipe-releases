import Foundation

struct GigaAMModelAssets {
    let modelName = "gigaam-v3-e2e-rnnt-coreml"
    let repositoryBaseURL =
        URL(string: "https://huggingface.co/smkrv/gigaam-v3-e2e-rnnt-coreml/resolve/main/")!

    struct Asset: Sendable {
        let relativePath: String
        let expectedSize: Int64
    }

    let requiredAssets: [Asset] = [
        Asset(
            relativePath: "GigaAMv3Encoder.mlpackage/Data/com.apple.CoreML/model.mlmodel",
            expectedSize: 419_364),
        Asset(
            relativePath: "GigaAMv3Encoder.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
            expectedSize: 441_545_792),
        Asset(relativePath: "GigaAMv3Encoder.mlpackage/Manifest.json", expectedSize: 617),
        Asset(
            relativePath: "GigaAMv3DecoderStep.mlpackage/Data/com.apple.CoreML/model.mlmodel",
            expectedSize: 7_367),
        Asset(
            relativePath: "GigaAMv3DecoderStep.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
            expectedSize: 2_297_280),
        Asset(relativePath: "GigaAMv3DecoderStep.mlpackage/Manifest.json", expectedSize: 617),
        Asset(
            relativePath: "GigaAMv3JointStep.mlpackage/Data/com.apple.CoreML/model.mlmodel",
            expectedSize: 2_916),
        Asset(
            relativePath: "GigaAMv3JointStep.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
            expectedSize: 1_356_098),
        Asset(relativePath: "GigaAMv3JointStep.mlpackage/Manifest.json", expectedSize: 617),
        Asset(relativePath: "tokens.json", expectedSize: 12_406),
        Asset(relativePath: "LICENSE", expectedSize: 1_070),
    ]

    let modelDirectory: URL

    var encoderPackageURL: URL {
        modelDirectory.appendingPathComponent("GigaAMv3Encoder.mlpackage", isDirectory: true)
    }

    var decoderPackageURL: URL {
        modelDirectory.appendingPathComponent("GigaAMv3DecoderStep.mlpackage", isDirectory: true)
    }

    var jointPackageURL: URL {
        modelDirectory.appendingPathComponent("GigaAMv3JointStep.mlpackage", isDirectory: true)
    }

    var tokensURL: URL {
        modelDirectory.appendingPathComponent("tokens.json")
    }

    var isInstalled: Bool {
        requiredAssets.allSatisfy { asset in
            let url = modelDirectory.appendingPathComponent(asset.relativePath)
            guard
                let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
                let fileSize = values.fileSize
            else {
                return false
            }
            return Int64(fileSize) == asset.expectedSize
        }
    }
}

