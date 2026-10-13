#!/usr/bin/env python3
"""Local GigaAM replay; no microphone, settings, credentials or cloud requests.

Use --policy before with the baseline helper, after with the optimized helper.
Cold means a new helper process; filesystem/CoreML/OS caches are not flushed.
This measures provider + scheduling latency, excluding UI, paste and Enhance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import wave

TEXT = ('Сегодня мы проверяем скорость появления текста. Приложение должно быстро '
        'показывать слова во время записи, сохранять точный результат после остановки '
        'и не терять окончания предложений. Это повторяемый локальный тест.')

class Helper:
    def __init__(self, binary, model):
        self.model = str(model)
        self.process = subprocess.Popen([str(binary)], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
    def send(self, path=None, cancel=None):
        message = dict(action='coreml' if path else 'prepareCoreML', modelPath=self.model)
        if path: message['path'] = str(path)
        if cancel: message['cancelPath'] = str(cancel)
        self.process.stdin.write(json.dumps(message) + '\n')
        self.process.stdin.flush()
    def read(self):
        line = self.process.stdout.readline()
        if not line: raise RuntimeError('Native helper exited before returning a result')
        return json.loads(line)
    def recognize(self, path):
        self.send(path)
        result = self.read()
        if 'error' in result: raise RuntimeError(result['error'])
        return result['text']
    def close(self):
        self.process.stdin.close()
        try: self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()

class Replay:
    def __init__(self, root, fixture):
        self.root = root
        with wave.open(str(fixture), 'rb') as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (16000, 1, 2):
                raise ValueError('Fixture must be mono 16 kHz, 16-bit PCM WAV')
            self.data = wav.readframes(wav.getnframes())
        self.duration = len(self.data) / 32000
        if self.duration < 12: raise ValueError('At least 12 seconds of speech are needed')
    def audio(self, end, start=0, repeat=False):
        path = self.root / 'window.wav'
        data = self.data * 3 if repeat else self.data
        with wave.open(str(path), 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(data[int(start * 16000) * 2:int(end * 16000) * 2])
        return path
    def live(self, helper, after):
        begin = time.monotonic()
        signal = self.root / 'cancel-session'
        signal.unlink(missing_ok=True)
        # Stop on wall clock even if the helper is still loading/recognizing.
        # Late text is rejected, just like the recording-generation guard.
        timer = threading.Timer(10, signal.touch)
        timer.start()
        try:
            return self._live(helper, after, begin, signal)
        finally:
            timer.cancel(); timer.join(); signal.unlink(missing_ok=True)

    def _live(self, helper, after, begin, signal):
        stop_at = begin + 10
        if after: helper.send(cancel=signal)
        pending_prepare = after
        next_request = begin + (1 if after else 1.4)
        first = None
        calls = []
        while next_request < begin + 10:
            time.sleep(max(0, next_request - time.monotonic()))
            attempt = time.monotonic()
            end = min(10, attempt - begin)
            # Same 12-second window, 2-second overlap, 500 ms fresh-audio gate.
            start = max(0, int((end - 2) // 10) * 10)
            helper.send(self.audio(end, start), cancel=signal)
            if pending_prepare:
                prepared = helper.read(); pending_prepare = False
                if 'error' in prepared and not (time.monotonic() >= stop_at and prepared['error'] == 'Canceled'):
                    raise RuntimeError(prepared['error'])
            result = helper.read()
            now = time.monotonic()
            if 'error' in result and not (now >= stop_at and result['error'] == 'Canceled'):
                raise RuntimeError(result['error'])
            calls.append(dict(audio_end_s=round(end, 3), request_ms=round((now-attempt)*1000, 2)))
            if now >= stop_at: break
            if result.get('text', '').strip() and first is None: first = (now - begin) * 1000
            next_request = (attempt if after else now) + .7
            if after: next_request = max(next_request, begin + end + .5)
        time.sleep(max(0, stop_at - time.monotonic()))
        signal.touch()
        final = helper.recognize(self.audio(10))
        elapsed = (time.monotonic() - stop_at) * 1000
        return dict(first_text_ms=round(first, 2) if first is not None else None,
            stop_to_final_ms=round(elapsed, 2), calls=calls, final=final)
    def short(self, helper, after):
        path = self.audio(.9)
        signal = self.root / 'cancel-short'
        signal.unlink(missing_ok=True)
        if after: helper.send(cancel=signal)
        time.sleep(.9)
        stop = time.monotonic(); signal.touch(); helper.send(path)
        if after: helper.read()
        result = helper.read()
        elapsed = (time.monotonic() - stop) * 1000
        signal.unlink(missing_ok=True)
        return dict(stop_to_final_ms=round(elapsed, 2), result=result)
    def race(self, helper):
        path = self.audio(12)
        reference = helper.recognize(path)
        rows = []
        for run in range(7):
            signal = self.root / 'cancel-live'; signal.unlink(missing_ok=True)
            helper.send(path, signal)
            time.sleep(.010)
            stop = time.monotonic(); signal.touch(); helper.send(path)
            live = helper.read(); final = helper.read()
            rows.append(dict(run=run, stop_to_final_ms=round((time.monotonic()-stop)*1000, 2),
                live_canceled=live.get('error') == 'Canceled', final_matches=final.get('text') == reference))
            signal.unlink(missing_ok=True)
        return rows
    def quality(self, helper):
        rows = []
        for seconds in [1, 3, 5, 10, 12, self.duration, 35]:
            path = self.audio(seconds, repeat=True)
            start = time.monotonic(); text = helper.recognize(path)
            rows.append(dict(seconds=seconds, text=text, inference_ms=round((time.monotonic()-start)*1000, 2)))
        return rows

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adapter', type=Path, default=Path('/Applications/No Type.app/Contents/Resources/platform/no-tipe-platform'))
    parser.add_argument('--model-dir', type=Path, default=Path.home()/'Library/Application Support/app.no-tipe.desktop/models/gigaam-v3-e2e-rnnt-coreml')
    parser.add_argument('--fixture', type=Path)
    parser.add_argument('--policy', choices=['before', 'after'], required=True)
    parser.add_argument('--scenario', choices=['all', 'live', 'short', 'race', 'quality'], default='all')
    parser.add_argument('--rounds', type=int, default=3)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.rounds < 1: parser.error('--rounds must be positive')
    output = dict(policy=args.policy, adapter_sha256=hashlib.sha256(args.adapter.read_bytes()).hexdigest(),
        cold_definition='new helper process, unloaded weights; OS caches retained',
        excludes=['microphone', 'UI rendering', 'paste', 'Enhance'], live=[], short=[], race=[], quality=[])
    with tempfile.TemporaryDirectory(prefix='no-tipe-asr-replay-') as directory:
        root = Path(directory)
        fixture = args.fixture
        if fixture is None:
            subprocess.run(['say', '-v', 'Milena', '-r', '175', '-o', str(root/'speech.aiff'), TEXT], check=True)
            fixture = root/'speech.wav'
            subprocess.run(['afconvert', '-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', str(root/'speech.aiff'), str(fixture)], check=True)
        output['fixture_sha256'] = hashlib.sha256(fixture.read_bytes()).hexdigest()
        replay = Replay(root, fixture)
        output['fixture_duration_s'] = replay.duration
        for scenario in ['live', 'short', 'race', 'quality']:
            if args.scenario not in ['all', scenario]: continue
            rounds = args.rounds if scenario in ['live', 'short'] else 1
            for run in range(rounds):
                helper = Helper(args.adapter, args.model_dir)
                try:
                    if scenario in ['live', 'short']:
                        for warm in [False, True]:
                            row = getattr(replay, scenario)(helper, args.policy == 'after')
                            row.update(run=run, warm=warm); output[scenario].append(row)
                            print(json.dumps({k:v for k,v in row.items() if k not in ['calls', 'final', 'result']}, ensure_ascii=False), flush=True)
                    else:
                        output[scenario] = getattr(replay, scenario)(helper)
                        print(f'{scenario}: {len(output[scenario])} cases', flush=True)
                finally: helper.close()
    args.out.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__': main()
