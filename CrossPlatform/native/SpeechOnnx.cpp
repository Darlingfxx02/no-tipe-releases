#include "c-api.h"
#include <cstdint>
#include <string>

// Keep the versioned C layout in C++; Rust owns only opaque recognizer handles.
extern "C" const void *no_type_speech_create(const char *directory, const char *architecture,
    const char *model_file, const char *decoder_file, const char *joiner_file,
    const char *tokens_file, int32_t feature_dim, int32_t threads) {
    try {
        std::string base(directory);
        const auto encoder=base+"/"+model_file, decoder=base+"/"+decoder_file;
        const auto joiner=base+"/"+joiner_file, tokens=base+"/"+tokens_file;
        SherpaOnnxOfflineRecognizerConfig config{};
        config.feat_config.sample_rate=16000;
        config.feat_config.feature_dim=feature_dim;
        if (std::string(architecture)=="nemo_ctc") config.model_config.nemo_ctc.model=encoder.c_str();
        else config.model_config.transducer={encoder.c_str(),decoder.c_str(),joiner.c_str()};
        config.model_config.tokens=tokens.c_str();
        config.model_config.model_type=architecture;
        config.model_config.provider="cpu";
        config.model_config.num_threads=threads;
        config.decoding_method="greedy_search";
        config.max_active_paths=4;
        return SherpaOnnxCreateOfflineRecognizer(&config);
    } catch (...) {return nullptr;}
}
extern "C" void no_type_speech_destroy(const void *recognizer) {
    SherpaOnnxDestroyOfflineRecognizer(static_cast<const SherpaOnnxOfflineRecognizer *>(recognizer));
}
extern "C" const char *no_type_speech_decode(const void *handle, const float *samples, int32_t length) {
    const auto *recognizer=static_cast<const SherpaOnnxOfflineRecognizer *>(handle);
    auto *stream=SherpaOnnxCreateOfflineStream(recognizer);
    if (!stream) return nullptr;
    try {
        SherpaOnnxAcceptWaveformOffline(stream,16000,samples,length);
        SherpaOnnxDecodeOfflineStream(recognizer,stream);
        const auto *json=SherpaOnnxGetOfflineStreamResultAsJson(stream);
        SherpaOnnxDestroyOfflineStream(stream);
        return json;
    } catch (...) {SherpaOnnxDestroyOfflineStream(stream);return nullptr;}
}
extern "C" void no_type_speech_result_free(const char *result) {
    SherpaOnnxDestroyOfflineStreamResultJson(result);
}
