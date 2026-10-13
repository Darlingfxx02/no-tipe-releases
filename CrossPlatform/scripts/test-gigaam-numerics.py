#!/usr/bin/env python3
"""Compare all padded mel values with the unmodified reference, without weights."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[2]
reference = (root / 'NoTipe/Transcription/GigaAM/GigaAMTranscriptionService.swift').read_text()
optimized = (root / 'CrossPlatform/native/GigaAM.swift').read_text()
marker = 'private final class GigaAMMelSpectrogram'
reference = reference[reference.index(marker):].replace('GigaAMMelSpectrogram', 'ReferenceMel')
optimized = optimized[optimized.index(marker):].replace('GigaAMMelSpectrogram', 'OptimizedMel')
test = '''
@main struct NumericsTest {
    static func main() throws {
        let reference = ReferenceMel()
        let optimized = OptimizedMel()
        for count in [0, 1, 319, 320, 321, 16000, 54321, 479999, 480000] {
            let samples = (0..<count).map { Float(sin(Double($0) * 0.171) * 0.2) }
            let (before, beforeLength) = try reference.features(for: samples)
            let (after, afterLength) = try optimized.features(for: samples)
            precondition(beforeLength == afterLength && before.shape == after.shape)
            let lhs = before.dataPointer.assumingMemoryBound(to: Float.self)
            let rhs = after.dataPointer.assumingMemoryBound(to: Float.self)
            for index in 0..<before.count {
                precondition(lhs[index].bitPattern == rhs[index].bitPattern,
                             "Mel feature differs at sample count \\(count), tensor index \\(index)")
            }
        }
        print("GigaAM mel tensors are bit-identical for 9 lengths, including partial frames and full padding.")
    }
}
'''
env = os.environ.copy()
xcode = Path('/Users/darlingfxx/Downloads/Xcode-beta.app/Contents/Developer')
if 'DEVELOPER_DIR' not in env and xcode.is_dir():
    env['DEVELOPER_DIR'] = str(xcode)
with tempfile.TemporaryDirectory(prefix='no-tipe-gigaam-numerics-') as directory:
    source = Path(directory) / 'Numerics.swift'
    source.write_text('import Accelerate\nimport CoreML\nimport Foundation\n' + reference + optimized + test)
    binary = Path(directory) / 'numerics'
    subprocess.run(['xcrun', 'swiftc', '-O', '-parse-as-library', str(source), '-o', str(binary)], env=env, check=True)
    subprocess.run([str(binary)], check=True)
