#!/usr/bin/env python3
"""Generate local demo audio + covers for 听一听 / 看一看."""
import math
import os
import struct
import wave

from PIL import Image, ImageDraw

DEMO = r"C:\perry\data\media\demo"
os.makedirs(DEMO, exist_ok=True)


def write_wav(path, notes, bpm=90, vol=0.35):
    rate = 22050
    samples = []
    for freq, beats in notes:
        n = int(rate * 60 / bpm * beats)
        for i in range(n):
            t = i / rate
            env = min(1.0, i / 200.0) * min(1.0, (n - i) / 400.0)
            s = math.sin(2 * math.pi * freq * t) * vol * env
            samples.append(int(max(-32767, min(32767, s * 32767))))
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", s) for s in samples))


def make_cover(path, c1, c2, title, sub):
    img = Image.new("RGB", (480, 480))
    d = ImageDraw.Draw(img)
    for y in range(480):
        t = y / 479
        r = int(int(c1[1:3], 16) * (1 - t) + int(c2[1:3], 16) * t)
        g = int(int(c1[3:5], 16) * (1 - t) + int(c2[3:5], 16) * t)
        b = int(int(c1[5:7], 16) * (1 - t) + int(c2[5:7], 16) * t)
        d.line([(0, y), (480, y)], fill=(r, g, b))
    d.ellipse((140, 120, 340, 320), outline=(255, 255, 255), width=6)
    d.text((240, 220), title, fill=(255, 255, 255), anchor="mm")
    d.text((240, 400), sub, fill=(230, 230, 230), anchor="mm")
    img.save(path, "PNG")


write_wav(
    os.path.join(DEMO, "listen-calm.wav"),
    [
        (262, 1), (330, 1), (392, 1), (523, 1), (392, 1), (330, 1), (262, 2),
        (294, 1), (349, 1), (440, 1), (494, 1), (440, 1), (349, 1), (294, 2),
    ],
)
write_wav(
    os.path.join(DEMO, "listen-pop.wav"),
    [
        (392, 0.5), (392, 0.5), (440, 0.5), (494, 0.5), (523, 1),
        (494, 0.5), (440, 0.5), (392, 1),
        (349, 0.5), (349, 0.5), (392, 0.5), (440, 0.5), (494, 1),
        (440, 0.5), (392, 0.5), (349, 1),
    ],
)
write_wav(
    os.path.join(DEMO, "listen-night.wav"),
    [
        (220, 2), (247, 2), (262, 2), (294, 2),
        (330, 1.5), (294, 0.5), (262, 2), (220, 2),
    ],
)

covers = {
    "cover-bgm.png": ("#1a2744", "#3d5a80", "BGM", "叠塔挑战原声"),
    "cover-game.png": ("#3d2b1f", "#8b5a2b", "音效", "游戏提示音"),
    "cover-calm.png": ("#1e3a2f", "#2d6a4f", "静心", "轻音乐 Demo"),
    "cover-pop.png": ("#3d1e4a", "#7b2d8b", "热歌", "节奏 Demo"),
    "cover-night.png": ("#0d1b2a", "#1b263b", "夜色", "氛围 Demo"),
    "cover-flower.png": ("#2d6a4f", "#95d5b2", "花开", "CC0 短片"),
    "cover-sintel.png": ("#4a1942", "#9b3d3d", "Sintel", "开源预告"),
    "cover-sample.png": ("#264653", "#2a9d8f", "示例", "本地样片"),
}
for name, (c1, c2, t, s) in covers.items():
    make_cover(os.path.join(DEMO, name), c1, c2, t, s)

print("ok", sorted(os.listdir(DEMO)))
