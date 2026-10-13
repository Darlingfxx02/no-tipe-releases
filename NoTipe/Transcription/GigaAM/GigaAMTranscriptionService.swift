import Accelerate
import CoreML
import Foundation
import os

final class GigaAMTranscriptionService: TranscriptionService {
    private let engine = GigaAMInferenceEngine()

    func transcribe(
        audioURL: URL,
        model _: any TranscriptionModel,
        context _: TranscriptionRequestContext
    ) async throws -> String {
        try await engine.transcribe(audioURL: audioURL)
    }
}

private actor GigaAMInferenceEngine {
    enum InferenceError: LocalizedError {
        case modelNotInstalled
        case invalidModelOutput(String)
        case emptyAudio

        var errorDescription: String? {
            switch self {
            case .modelNotInstalled:
                return String(localized: "GigaAM is not downloaded. Download it from AI Models.")
            case .invalidModelOutput(let name):
                return String(format: String(localized: "GigaAM returned an invalid %@ tensor."), name)
            case .emptyAudio:
                return String(localized: "The recording does not contain enough audio for GigaAM.")
            }
        }
    }

    private struct LoadedModels {
        let encoder: MLModel
        let decoder: MLModel
        let joint: MLModel
        let tokens: [String]
    }

    private let logger = Logger(subsystem: "app.no-tipe.desktop", category: "GigaAMTranscription")
    private let melExtractor = GigaAMMelSpectrogram()
    private var loadedModels: LoadedModels?

    func transcribe(audioURL: URL) async throws -> String {
        guard GigaAMModelAssets.isInstalled else {
            throw InferenceError.modelNotInstalled
        }

        let samples = try await AudioProcessor().processAudioToSamples(audioURL)
        guard samples.count >= 320 else {
            throw InferenceError.emptyAudio
        }

        let models = try loadModelsIfNeeded()
        let chunks = splitIntoSpeechFriendlyWindows(samples)
        var results: [String] = []
        results.reserveCapacity(chunks.count)

        for chunk in chunks {
            try Task.checkCancellation()
            let text = try recognize(chunk, using: models)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                results.append(text)
            }
        }

        let result = results.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        logger.notice("GigaAM transcription completed with \(chunks.count, privacy: .public) window(s).")
        return result
    }

    private func loadModelsIfNeeded() throws -> LoadedModels {
        if let loadedModels {
            return loadedModels
        }

        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuAndGPU

        let encoder = try compileAndLoad(GigaAMModelAssets.encoderPackageURL, configuration: configuration)
        let decoder = try compileAndLoad(GigaAMModelAssets.decoderPackageURL, configuration: configuration)
        let joint = try compileAndLoad(GigaAMModelAssets.jointPackageURL, configuration: configuration)
        let tokenData = try Data(contentsOf: GigaAMModelAssets.tokensURL)
        let tokens = try JSONDecoder().decode([String].self, from: tokenData)

        let models = LoadedModels(encoder: encoder, decoder: decoder, joint: joint, tokens: tokens)
        loadedModels = models
        return models
    }

    private func compileAndLoad(_ packageURL: URL, configuration: MLModelConfiguration) throws -> MLModel {
        let compiledURL = try MLModel.compileModel(at: packageURL)
        return try MLModel(contentsOf: compiledURL, configuration: configuration)
    }

    private func recognize(_ samples: [Float], using models: LoadedModels) throws -> String {
        let (features, featureLength) = try melExtractor.features(for: samples)
        let length = try makeMultiArray(shape: [1], dataType: .int32)
        length[0] = NSNumber(value: Int32(featureLength))

        let encoderInput = try MLDictionaryFeatureProvider(dictionary: [
            "features": MLFeatureValue(multiArray: features),
            "length": MLFeatureValue(multiArray: length),
        ])
        let encoderOutput = try models.encoder.prediction(from: encoderInput)
        guard
            let encoded = encoderOutput.featureValue(for: "encoded")?.multiArrayValue,
            let encodedLengthArray = encoderOutput.featureValue(for: "encoded_len")?.multiArrayValue
        else {
            throw InferenceError.invalidModelOutput("encoder")
        }

        let encodedLength = min(750, encodedLengthArray[0].intValue)
        let hidden = try makeMultiArray(shape: [1, 1, 320], dataType: .float32)
        let cell = try makeMultiArray(shape: [1, 1, 320], dataType: .float32)
        var stateH = hidden
        var stateC = cell
        var lastToken = 1024
        var tokenIDs: [Int] = []

        for frameIndex in 0..<encodedLength {
            try Task.checkCancellation()
            let encoderFrame = try sliceEncoderFrame(encoded, frameIndex: frameIndex)

            for _ in 0..<10 {
                let token = try makeMultiArray(shape: [1, 1], dataType: .int32)
                token[0] = NSNumber(value: Int32(lastToken))

                let decoderInput = try MLDictionaryFeatureProvider(dictionary: [
                    "token": MLFeatureValue(multiArray: token),
                    "h_in": MLFeatureValue(multiArray: stateH),
                    "c_in": MLFeatureValue(multiArray: stateC),
                ])
                let decoderOutput = try models.decoder.prediction(from: decoderInput)
                guard
                    let decoderVector = decoderOutput.featureValue(for: "dec_out")?.multiArrayValue,
                    let nextH = decoderOutput.featureValue(for: "h_out")?.multiArrayValue,
                    let nextC = decoderOutput.featureValue(for: "c_out")?.multiArrayValue
                else {
                    throw InferenceError.invalidModelOutput("decoder")
                }

                let jointInput = try MLDictionaryFeatureProvider(dictionary: [
                    "enc_t": MLFeatureValue(multiArray: encoderFrame),
                    "dec_t": MLFeatureValue(multiArray: decoderVector),
                ])
                let jointOutput = try models.joint.prediction(from: jointInput)
                guard let logits = jointOutput.featureValue(for: "logits")?.multiArrayValue else {
                    throw InferenceError.invalidModelOutput("joint")
                }

                let nextToken = argmax(logits)
                if nextToken == 1024 {
                    break
                }

                guard models.tokens.indices.contains(nextToken) else {
                    throw InferenceError.invalidModelOutput("token")
                }

                tokenIDs.append(nextToken)
                stateH = nextH
                stateC = nextC
                lastToken = nextToken
            }
        }

        return tokenIDs.map { models.tokens[$0] }
            .joined()
            .replacingOccurrences(of: "▁", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sliceEncoderFrame(_ encoded: MLMultiArray, frameIndex: Int) throws -> MLMultiArray {
        let frame = try makeMultiArray(shape: [1, 768], dataType: .float32)
        for hiddenIndex in 0..<768 {
            frame[hiddenIndex] = encoded[
                [NSNumber(value: 0), NSNumber(value: hiddenIndex), NSNumber(value: frameIndex)]]
        }
        return frame
    }

    private func makeMultiArray(shape: [NSNumber], dataType: MLMultiArrayDataType) throws -> MLMultiArray {
        let array = try MLMultiArray(shape: shape, dataType: dataType)
        for index in 0..<array.count {
            array[index] = 0
        }
        return array
    }

    private func argmax(_ values: MLMultiArray) -> Int {
        var bestIndex = 0
        var bestValue = -Float.greatestFiniteMagnitude
        for index in 0..<values.count {
            let value = values[index].floatValue
            if value > bestValue {
                bestValue = value
                bestIndex = index
            }
        }
        return bestIndex
    }

    private func splitIntoSpeechFriendlyWindows(_ samples: [Float]) -> [[Float]] {
        let maximumWindow = 30 * 16_000
        guard samples.count > maximumWindow else {
            return [samples]
        }

        let earliestCut = 24 * 16_000
        let searchStep = 800
        let energyWindow = 1_600
        var chunks: [[Float]] = []
        var offset = 0

        while samples.count - offset > maximumWindow {
            let hardEnd = offset + maximumWindow
            let searchStart = offset + earliestCut
            var bestCut = hardEnd
            var bestEnergy = Float.greatestFiniteMagnitude

            if searchStart + energyWindow < hardEnd {
                var candidate = searchStart
                while candidate + energyWindow < hardEnd {
                    var energy: Float = 0
                    samples.withUnsafeBufferPointer { pointer in
                        vDSP_svesq(
                            pointer.baseAddress! + candidate,
                            1,
                            &energy,
                            vDSP_Length(energyWindow)
                        )
                    }
                    if energy < bestEnergy {
                        bestEnergy = energy
                        bestCut = candidate + energyWindow / 2
                    }
                    candidate += searchStep
                }
            }

            chunks.append(Array(samples[offset..<bestCut]))
            offset = bestCut
        }

        if offset < samples.count {
            chunks.append(Array(samples[offset...]))
        }
        return chunks
    }
}

private final class GigaAMMelSpectrogram {
    private let sampleRate = 16_000
    private let melCount = 64
    private let fftSize = 320
    private let hopLength = 160
    private let windowLength = 320
    private let frameCount = 2_999
    private let maximumSamples = 30 * 16_000
    private let hannWindow: [Float]
    private let melFilterbank: [[Float]]
    private let fftSetup: vDSP_DFT_Setup

    init() {
        let configuredWindowLength = 320
        hannWindow = (0..<configuredWindowLength).map { index in
            0.5 * (1 - cos(2 * Float.pi * Float(index) / Float(configuredWindowLength)))
        }
        melFilterbank = Self.makeHTKMelFilterbank(
            fftSize: fftSize,
            melCount: melCount,
            sampleRate: sampleRate
        )
        guard let setup = vDSP_DFT_zop_CreateSetup(nil, vDSP_Length(fftSize), .FORWARD) else {
            fatalError("Unable to initialize the GigaAM FFT")
        }
        fftSetup = setup
    }

    deinit {
        vDSP_DFT_DestroySetup(fftSetup)
    }

    func features(for inputSamples: [Float]) throws -> (MLMultiArray, Int) {
        let trueSampleCount = min(inputSamples.count, maximumSamples)
        let featureLength = max(1, (trueSampleCount - windowLength) / hopLength + 1)
        var paddedSamples = [Float](repeating: 0, count: maximumSamples)
        if trueSampleCount > 0 {
            paddedSamples.replaceSubrange(0..<trueSampleCount, with: inputSamples.prefix(trueSampleCount))
        }

        let output = try MLMultiArray(
            shape: [NSNumber(value: 1), NSNumber(value: melCount), NSNumber(value: frameCount)],
            dataType: .float32
        )
        let outputPointer = output.dataPointer.bindMemory(to: Float.self, capacity: output.count)

        var realInput = [Float](repeating: 0, count: fftSize)
        var imaginaryInput = [Float](repeating: 0, count: fftSize)
        var realOutput = [Float](repeating: 0, count: fftSize)
        var imaginaryOutput = [Float](repeating: 0, count: fftSize)
        var power = [Float](repeating: 0, count: fftSize / 2 + 1)

        for frameIndex in 0..<frameCount {
            let start = frameIndex * hopLength
            for sampleIndex in 0..<windowLength {
                realInput[sampleIndex] = paddedSamples[start + sampleIndex] * hannWindow[sampleIndex]
            }
            vDSP_vclr(&imaginaryInput, 1, vDSP_Length(fftSize))
            vDSP_DFT_Execute(fftSetup, realInput, imaginaryInput, &realOutput, &imaginaryOutput)

            for frequencyIndex in 0..<power.count {
                let real = realOutput[frequencyIndex]
                let imaginary = imaginaryOutput[frequencyIndex]
                power[frequencyIndex] = real * real + imaginary * imaginary
            }

            for melIndex in 0..<melCount {
                var value: Float = 0
                vDSP_dotpr(
                    melFilterbank[melIndex],
                    1,
                    power,
                    1,
                    &value,
                    vDSP_Length(power.count)
                )
                outputPointer[melIndex * frameCount + frameIndex] = log(min(1e9, max(1e-9, value)))
            }
        }

        return (output, min(featureLength, frameCount))
    }

    private static func makeHTKMelFilterbank(
        fftSize: Int,
        melCount: Int,
        sampleRate: Int
    ) -> [[Float]] {
        let frequencyBinCount = fftSize / 2 + 1

        func hertzToMel(_ hertz: Float) -> Float {
            2_595 * log10(1 + hertz / 700)
        }

        func melToHertz(_ mel: Float) -> Float {
            700 * (pow(10, mel / 2_595) - 1)
        }

        let minimumMel = hertzToMel(0)
        let maximumMel = hertzToMel(Float(sampleRate) / 2)
        let melFrequencies = (0..<(melCount + 2)).map { index -> Float in
            let mel = minimumMel + Float(index) * (maximumMel - minimumMel) / Float(melCount + 1)
            return melToHertz(mel)
        }

        return (0..<melCount).map { melIndex in
            let left = melFrequencies[melIndex]
            let center = melFrequencies[melIndex + 1]
            let right = melFrequencies[melIndex + 2]

            return (0..<frequencyBinCount).map { frequencyIndex in
                let frequency = Float(frequencyIndex * sampleRate) / Float(fftSize)
                if frequency >= left && frequency < center {
                    return (frequency - left) / (center - left)
                }
                if frequency >= center && frequency <= right {
                    return (right - frequency) / (right - center)
                }
                return 0
            }
        }
    }
}
