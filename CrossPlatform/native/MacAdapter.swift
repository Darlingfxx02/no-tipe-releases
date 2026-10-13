import AppKit
import AVFoundation
import ApplicationServices
import Foundation

final class AudioProcessor {
    func processAudioToSamples(_ url: URL) async throws -> [Float] {
        // Rust supplies canonical mono 16 kHz WAV; no duplicate decoder here.
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        guard format.sampleRate == 16000, format.channelCount == 1
        else { throw NSError(domain: "NoTipe", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected 16 kHz mono audio"]) }
        // A valid WAV may contain only its header. Reading a zero-frame buffer
        // throws AVFAudio -50 before GigaAM can report insufficient audio.
        guard file.length > 0 else { return [] }
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(file.length))
        else { throw NSError(domain: "NoTipe", code: 2, userInfo: [NSLocalizedDescriptionKey: "Could not read the recorded audio"]) }
        try file.read(into: buffer)
        guard let samples = buffer.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: samples, count: Int(buffer.frameLength)))
    }
}

@main
struct MacAdapter {
    @MainActor static var gigaAM: GigaAMInferenceEngine?
    @MainActor static var gigaAMDirectory: String?

    @MainActor static func handle(_ message: [String: Any]) async throws -> [String: Any] {
        switch message["action"] as? String {
        case "coreml", "prepareCoreML":
            guard let directory = message["modelPath"] as? String else { return ["error": "Missing model directory"] }
            let cancelPath = (message["cancelPath"] as? String).map { URL(fileURLWithPath: $0) }
            if let cancelPath, FileManager.default.fileExists(atPath: cancelPath.path) {
                return ["error": "Canceled"]
            }
            if gigaAMDirectory != directory || gigaAM == nil {
                gigaAM = GigaAMInferenceEngine(directory: URL(fileURLWithPath: directory))
                gigaAMDirectory = directory
            }
            if message["action"] as? String == "prepareCoreML" {
                try await gigaAM!.prepare()
                return ["ready": true]
            }
            guard let path = message["path"] as? String else { return ["error": "Missing audio file"] }
            return ["text": try await gigaAM!.transcribe(audioURL: URL(fileURLWithPath: path), cancelPath: cancelPath)]
        default: return ["error": "Unknown platform action"]
        }
    }

    static func main() async {
        // Read stdin off the main actor so AX callbacks and clipboard restoration
        // can run while the adapter is idle. No transcript/credential logging.
        while let line = await Task.detached(operation: { readLine() }).value {
            do {
                guard let data = line.data(using: .utf8), let message = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                let result = try await handle(message)
                let encoded = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
                FileHandle.standardOutput.write(encoded + Data([10]))
            } catch {
                let result = ["error": error.localizedDescription]
                if let data = try? JSONSerialization.data(withJSONObject: result) { FileHandle.standardOutput.write(data + Data([10])) }
            }
        }
    }
}
