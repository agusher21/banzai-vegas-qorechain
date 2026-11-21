#!/usr/bin/env python3
"""Assemble the Banzai Vegas demo video — QOR version: stills + narration
-> 1920x1080 mp4. Adapted from assemble.py (BNZ version). Segment durations
are scaled from measured narration; word counts are derived from the segment
text below (bare em-dash tokens are not words)."""
import json
import subprocess

D = "/home/hatch/workspace/banzai-vegas-qorechain/demo-video"
SHOTS = D + "/shots-qor"
OUT = D + "/banzai-vegas-demo-qor.mp4"

# (file, narration text spoken over it, minimum seconds)
SEGMENTS = [
    (SHOTS + "/01-hero.png",
     "Banzai Vegas is an on-chain raffle on the QoreChain testnet.", 4.0),
    (SHOTS + "/02-picker.png",
     "Buy QOR tickets — five QOR each, up to twenty per round — and win the "
     "pot: thirty percent for first place, eighteen for second, twelve for "
     "third, plus lucky lots.", 6.0),
    (SHOTS + "/03-how.png",
     "Draws run every day at twenty hundred UTC, automatic. QOR is free on "
     "testnet: the faucet gives you a hundred QOR a day.", 5.0),
    (SHOTS + "/04-wallet.png",
     "To play, connect your wallet on the QoreChain testnet and buy your "
     "tickets.", 4.0),
    (SHOTS + "/05a-raffle-explorer.png",
     "What makes this post-quantum: the operator runs on an ML-DSA-87 key "
     "registered on chain,", 4.0),
    (SHOTS + "/05b-pqc-tx.png",
     "and every deploy ran inside a hybrid-signed EVM window —", 4.0),
    (SHOTS + "/05c-window-tx.png",
     "secp256k1 plus ML-DSA-87.", 4.0),
    (D + "/closing.png",
     "The contracts are live, raffle number one is open, and the first draw "
     "is Sunday the twenty-second of November at twenty hundred UTC. Try it "
     "at the link below — testnet only, no real funds.", 6.0),
]


def word_count(text):
    return sum(1 for t in text.split() if any(c.isalnum() for c in t))


def probe_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", path],
        capture_output=True, text=True, check=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def run(cmd):
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main():
    words = [word_count(t) for _, t, _ in SEGMENTS]
    audio_dur = probe_duration(D + "/narration-qor.mp3")
    total_words = sum(words)
    rate = audio_dur / total_words
    raw = [max(w * rate, m) for w, (_, _, m) in zip(words, SEGMENTS)]
    scale = audio_dur / sum(raw)
    durs = [r * scale for r in raw]
    print(f"audio {audio_dur:.2f}s, {total_words} words, rate {rate:.3f}s/word")
    for (path, _, _), w, dur in zip(SEGMENTS, words, durs):
        print(f"  {dur:5.2f}s  {w:2d}w  {path.split('/')[-1]}")

    # 1. Scale every still to 1920x1080 PNG.
    scaled = []
    for i, (path, _, _) in enumerate(SEGMENTS):
        out = f"{D}/scaled-qor_{i:02d}.png"
        run(["ffmpeg", "-y", "-v", "error", "-i", path,
             "-vf", "scale=1920:1080:flags=lanczos", out])
        scaled.append(out)

    # 2. Concat list (last file listed twice per concat-demuxer rules).
    with open(D + "/concat-qor.txt", "w") as f:
        for img, dur in zip(scaled, durs):
            f.write(f"file '{img}'\nduration {dur:.3f}\n")
        f.write(f"file '{scaled[-1]}'\n")

    # 3. Video-only from stills.
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", D + "/concat-qor.txt", "-vf", "fps=30,format=yuv420p",
         "-c:v", "libx264", "-crf", "20", "-preset", "medium",
         "-video_track_timescale", "30", D + "/video-only-qor.mp4"])

    # 4. Mux narration, cut exactly at audio length.
    run(["ffmpeg", "-y", "-v", "error", "-i", D + "/video-only-qor.mp4",
         "-i", D + "/narration-qor.mp3", "-t", f"{audio_dur:.3f}",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
         "-movflags", "+faststart", OUT])
    print("wrote", OUT)


if __name__ == "__main__":
    main()
