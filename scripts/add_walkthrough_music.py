"""Render an original upbeat instrumental and add it to the local walkthrough.

Run with the workspace Python (NumPy is already a backend dependency):
    .venv/bin/python scripts/add_walkthrough_music.py

FFMPEG_BINARY can point to a full FFmpeg build; the optional, ignored local
artifacts/media-tools/imageio_ffmpeg/binaries installation is also detected.
This script and its original composition require no music service or API key.
"""
from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 44100
BPM = 112
BEAT = 60 / BPM


def encoder() -> str:
    explicit = os.environ.get('FFMPEG_BINARY')
    if explicit:
        return explicit
    installed = shutil.which('ffmpeg')
    if installed:
        return installed
    candidates = sorted((ROOT / 'artifacts/media-tools/imageio_ffmpeg/binaries').glob('ffmpeg-*'))
    if candidates:
        return str(candidates[0])
    raise SystemExit('Set FFMPEG_BINARY to a full FFmpeg build with H.264 and AAC encoders.')


def frequency(note: int) -> float:
    return 440 * 2 ** ((note - 69) / 12)


def render_music(destination: Path, duration: float) -> dict:
    """Deterministic original C-major synth arrangement, with no sampled music."""
    frames = math.ceil(duration * RATE)
    mix = np.zeros((frames, 2), dtype=np.float64)
    random = np.random.default_rng(1122026)

    def add(start: float, sound: np.ndarray, gain: float, pan: float = 0):
        offset = round(start * RATE)
        count = min(len(sound), frames - offset)
        if count <= 0:
            return
        mono = sound[:count] * gain
        mix[offset:offset + count, 0] += mono * math.sqrt((1 - pan) / 2)
        mix[offset:offset + count, 1] += mono * math.sqrt((1 + pan) / 2)

    def tone(note: int, length: float, decay: float = 5, soft: bool = False):
        t = np.arange(round(length * RATE)) / RATE
        f = frequency(note)
        sound = np.sin(2 * np.pi * f * t) + .22 * np.sin(2 * np.pi * f * 2 * t)
        if not soft:
            sound += .09 * np.sin(2 * np.pi * f * 3 * t)
        attack = np.minimum(1, t / (.04 if soft else .008))
        release = np.minimum(1, (length - t) / .06)
        envelope = attack * release * (np.exp(-decay * t) if decay else 1)
        return sound * envelope

    chords = [[60, 64, 67, 71], [59, 62, 67, 69], [57, 60, 64, 67], [57, 60, 65, 69]]
    bass = [36, 31, 33, 29]
    # An original, gently syncopated eight-bar pentatonic motif.
    motif = [72, None, 76, 79, None, 76, 74, None,
             71, None, 74, 79, 81, None, 79, 74,
             76, None, 79, 81, None, 79, 76, 72,
             77, None, 76, 72, 69, None, 72, None]
    bars = math.ceil(duration / (4 * BEAT))
    for bar in range(bars):
        start = bar * 4 * BEAT
        chord = chords[bar % 4]
        # Warm, restrained chord bed, and four soft bass pulses.
        for index, note in enumerate(chord):
            add(start, tone(note, 4 * BEAT, .5, soft=True), .055, (index - 1.5) / 3)
        for beat in range(4):
            add(start + beat * BEAT, tone(bass[bar % 4], .4, 6, soft=True), .22)
            t = np.arange(round(.22 * RATE)) / RATE
            kick = np.sin(2 * np.pi * (48 * t + 48 * .024 * (1 - np.exp(-t / .024))))
            add(start + beat * BEAT, kick * np.exp(-22 * t), .22)
            if beat in (1, 3):
                t = np.arange(round(.13 * RATE)) / RATE
                noise = random.normal(size=len(t))
                noise = np.concatenate(([0.0], np.diff(noise)))
                add(start + beat * BEAT, noise * np.exp(-40 * t), .035, .1)
        for eighth in range(8):
            at = start + eighth * BEAT / 2
            t = np.arange(round(.06 * RATE)) / RATE
            noise = random.normal(size=len(t))
            high = np.concatenate(([0.0], np.diff(noise)))
            add(at, high * np.exp(-70 * t), .012 if eighth % 2 == 0 else .021, -.35)
            note = motif[(bar % 4) * 8 + eighth]
            if note is not None:
                sound = tone(note, .47, 6)
                pan = .22 if eighth % 2 else -.22
                add(at, sound, .105, pan)
                add(at + .75 * BEAT, sound, .018, -pan)

    # Gentle compression, modest background level, and clean fades.
    mix = np.tanh(mix * 1.15)
    rms = float(np.sqrt(np.mean(mix ** 2)))
    mix *= min(.10 / max(rms, 1e-9), .65 / max(float(np.max(np.abs(mix))), 1e-9))
    fade_in = min(round(2.2 * RATE), frames)
    fade_out = min(round(3.2 * RATE), frames)
    mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    destination.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.round(np.clip(mix, -1, 1) * 32767).astype('<i2')
    with wave.open(str(destination), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    return {'duration_seconds': frames / RATE, 'sample_rate': RATE, 'channels': 2,
            'peak': round(float(np.max(np.abs(mix))), 4),
            'rms_dbfs': round(20 * math.log10(float(np.sqrt(np.mean(mix ** 2)))), 2),
            'tempo_bpm': BPM, 'composition': 'Original synthesized instrumental; no third-party music or samples'}


def video_duration(binary: str, source: Path) -> float:
    inspected = subprocess.run([binary, '-hide_banner', '-i', str(source)], capture_output=True, text=True)
    found = re.search(r'Duration: (\d+):(\d+):(\d+(?:\.\d+)?)', inspected.stderr)
    if not found:
        raise SystemExit('Cannot determine the local walkthrough duration.')
    hours, minutes, seconds = map(float, found.groups())
    return hours * 3600 + minutes * 60 + seconds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'artifacts/Nidhiksh-Markets-Walkthrough.webm')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/Nidhiksh-Markets-Walkthrough-Music.mp4')
    parser.add_argument('--audio-only', action='store_true')
    parser.add_argument('--duration', type=float, default=66)
    args = parser.parse_args()
    if args.duration <= 0 or args.duration > 3600:
        parser.error('Duration must be between zero and 3600 seconds.')
    duration = args.duration if args.audio_only else video_duration(encoder(), args.input)
    audio = args.output.parent / 'walkthrough-original-soundtrack.wav'
    metadata = render_music(audio, duration)
    metadata['audio'] = str(audio)
    if not args.audio_only:
        subprocess.run([encoder(), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(args.input),
                        '-i', str(audio), '-map', '0:v:0', '-map', '1:a:0',
                        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
                        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest',
                        '-metadata', 'comment=Original upbeat instrumental composed for the Nidhiksh Markets walkthrough',
                        str(args.output)], check=True)
        os.chmod(args.output, 0o600)
        metadata.update(video=str(args.output), output_duration_seconds=video_duration(encoder(), args.output),
                        bytes=args.output.stat().st_size, video_codec='H.264', audio_codec='AAC')
    (args.output.parent / 'walkthrough-music-metadata.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata))


if __name__ == '__main__':
    main()
