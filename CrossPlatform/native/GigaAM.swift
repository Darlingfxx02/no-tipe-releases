import Accelerate
import CoreML
import Foundation
import os
actor GigaAMInferenceEngine {
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
    private let assets: GigaAMModelAssets
    init(directory: URL) { assets = GigaAMModelAssets(modelDirectory: directory) }

    // Load the selected model while the microphone accumulates its first audio.
    func prepare() throws {
        guard assets.isInstalled else { throw InferenceError.modelNotInstalled }
        _ = try loadModelsIfNeeded()
    }

    private func checkCancellation(_ path: URL?) throws {
        try Task.checkCancellation()
        if let path, FileManager.default.fileExists(atPath: path.path) {
            throw NSError(domain: "NoTipe", code: 3, userInfo: [NSLocalizedDescriptionKey: "Canceled"])
        }
    }

    func transcribe(audioURL: URL, cancelPath: URL? = nil) async throws -> String {
        try checkCancellation(cancelPath)
        guard assets.isInstalled else {
            throw InferenceError.modelNotInstalled
        }

        let samples = try await AudioProcessor().processAudioToSamples(audioURL)
        guard samples.count >= 320 else {
            throw InferenceError.emptyAudio
        }

        let models = try loadModelsIfNeeded()
        try checkCancellation(cancelPath)
        let chunks = splitIntoSpeechFriendlyWindows(samples)
        var results: [String] = []
        results.reserveCapacity(chunks.count)

        for chunk in chunks {
            try checkCancellation(cancelPath)
            let text = try recognize(chunk, using: models, cancelPath: cancelPath)
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

        let encoder = try compileAndLoad(assets.encoderPackageURL, configuration: configuration)
        let decoder = try compileAndLoad(assets.decoderPackageURL, configuration: configuration)
        let joint = try compileAndLoad(assets.jointPackageURL, configuration: configuration)
        let tokenData = try Data(contentsOf: assets.tokensURL)
        let tokens = try JSONDecoder().decode([String].self, from: tokenData)

        let models = LoadedModels(encoder: encoder, decoder: decoder, joint: joint, tokens: tokens)
        loadedModels = models
        return models
    }

    private func compileAndLoad(_ packageURL: URL, configuration: MLModelConfiguration) throws -> MLModel {
        let compiledURL = try MLModel.compileModel(at: packageURL)
        return try MLModel(contentsOf: compiledURL, configuration: configuration)
    }

    private struct DecoderStep {
        let vector: MLMultiArray
        let nextH: MLMultiArray
        let nextC: MLMultiArray
    }

    private func recognize(_ samples: [Float], using models: LoadedModels, cancelPath: URL?) throws -> String {
        try checkCancellation(cancelPath)
        let (features, featureLength) = try melExtractor.features(for: samples)
        try checkCancellation(cancelPath)
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

        try checkCancellation(cancelPath)
        let encodedLength = min(750, encodedLengthArray[0].intValue)
        let hidden = try makeMultiArray(shape: [1, 1, 320], dataType: .float32)
        let cell = try makeMultiArray(shape: [1, 1, 320], dataType: .float32)
        var stateH = hidden
        var stateC = cell
        var lastToken = 1024
        var tokenIDs: [Int] = []
        var decoderStep: DecoderStep?

        for frameIndex in 0..<encodedLength {
            try checkCancellation(cancelPath)
            let encoderFrame = try sliceEncoderFrame(encoded, frameIndex: frameIndex)

            for _ in 0..<10 {
                // Blank consumes an encoder frame, but changes neither the token
                // nor recurrent state. Reuse this exact decoder prediction until
                // a non-blank token advances the state.
                if decoderStep == nil {
                    let token = try makeMultiArray(shape: [1, 1], dataType: .int32)
                    token[0] = NSNumber(value: Int32(lastToken))
                    let decoderInput = try MLDictionaryFeatureProvider(dictionary: [
                        "token": MLFeatureValue(multiArray: token),
                        "h_in": MLFeatureValue(multiArray: stateH),
                        "c_in": MLFeatureValue(multiArray: stateC),
                    ])
                    let decoderOutput = try models.decoder.prediction(from: decoderInput)
                    guard
                        let vector = decoderOutput.featureValue(for: "dec_out")?.multiArrayValue,
                        let nextH = decoderOutput.featureValue(for: "h_out")?.multiArrayValue,
                        let nextC = decoderOutput.featureValue(for: "c_out")?.multiArrayValue
                    else { throw InferenceError.invalidModelOutput("decoder") }
                    decoderStep = DecoderStep(vector: vector, nextH: nextH, nextC: nextC)
                }
                guard let step = decoderStep else { throw InferenceError.invalidModelOutput("decoder") }

                let jointInput = try MLDictionaryFeatureProvider(dictionary: [
                    "enc_t": MLFeatureValue(multiArray: encoderFrame),
                    "dec_t": MLFeatureValue(multiArray: step.vector),
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
                stateH = step.nextH
                stateC = step.nextC
                lastToken = nextToken
                decoderStep = nil
            }
        }

        return tokenIDs.map { models.tokens[$0] }
            .joined()
            .replacingOccurrences(of: "▁", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sliceEncoderFrame(_ encoded: MLMultiArray, frameIndex: Int) throws -> MLMultiArray {
        let frame = try makeMultiArray(shape: [1, 768], dataType: .float32)
        guard encoded.shape.count == 3, encoded.shape[1].intValue >= 768,
              encoded.shape[2].intValue > frameIndex else {
            throw InferenceError.invalidModelOutput("encoder")
        }
        if encoded.dataType == .float32 {
            let source = encoded.dataPointer.assumingMemoryBound(to: Float.self)
            let target = frame.dataPointer.assumingMemoryBound(to: Float.self)
            let hiddenStride = encoded.strides[1].intValue
            let timeOffset = frameIndex * encoded.strides[2].intValue
            for hiddenIndex in 0..<768 {
                target[hiddenIndex] = source[hiddenIndex * hiddenStride + timeOffset]
            }
        } else {
            for hiddenIndex in 0..<768 {
                frame[hiddenIndex] = encoded[
                    [NSNumber(value: 0), NSNumber(value: hiddenIndex), NSNumber(value: frameIndex)]]
            }
        }
        return frame
    }

    private func makeMultiArray(shape: [NSNumber], dataType: MLMultiArrayDataType) throws -> MLMultiArray {
        let array = try MLMultiArray(shape: shape, dataType: dataType)
        switch dataType {
        case .float32: array.dataPointer.assumingMemoryBound(to: Float.self).initialize(repeating: 0, count: array.count)
        case .int32: array.dataPointer.assumingMemoryBound(to: Int32.self).initialize(repeating: 0, count: array.count)
        default:
            for index in 0..<array.count { array[index] = 0 }
        }
        return array
    }

    private func argmax(_ values: MLMultiArray) -> Int {
        var bestIndex = 0
        var bestValue = -Float.greatestFiniteMagnitude
        var contiguous = values.dataType == .float32
        var stride = 1
        for dimension in values.shape.indices.reversed() {
            let size = values.shape[dimension].intValue
            if size > 1 && values.strides[dimension].intValue != stride { contiguous = false }
            stride *= size
        }
        if contiguous {
            let pointer = values.dataPointer.assumingMemoryBound(to: Float.self)
            for index in 0..<values.count {
                if pointer[index] > bestValue { bestValue = pointer[index]; bestIndex = index }
            }
            return bestIndex
        }
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
        // A fully padded frame has zero power in every mel band. Preserve the
        // same log floor exactly, without running FFTs on 30 seconds of padding.
        outputPointer.initialize(repeating: log(Float(1e-9)), count: output.count)
        let nonemptyFrames = min(frameCount, (trueSampleCount + hopLength - 1) / hopLength)

        var realInput = [Float](repeating: 0, count: fftSize)
        var imaginaryInput = [Float](repeating: 0, count: fftSize)
        var realOutput = [Float](repeating: 0, count: fftSize)
        var imaginaryOutput = [Float](repeating: 0, count: fftSize)
        var power = [Float](repeating: 0, count: fftSize / 2 + 1)

        for frameIndex in 0..<nonemptyFrames {
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
