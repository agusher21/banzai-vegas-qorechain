#!/usr/bin/env python3
"""Closing card for the Banzai Vegas demo video (PIL, 1920x1080).
Dark casino felt + gold, matching the live site."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1920, 1080
BG = (13, 13, 18)
GOLD = (245, 197, 24)
GOLD_DIM = (200, 160, 40)
PURPLE = (124, 92, 255)
WHITE = (240, 240, 245)
DIM = (170, 170, 180)

BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"


def font(path, size):
    return ImageFont.truetype(path, size)


def text_center(draw, y, text, fnt, color):
    bbox = draw.textbbox((0, 0), text, font=fnt)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, y), text, font=fnt, fill=color)
    return bbox[3] - bbox[1]


def main():
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # gold rule lines
    d.rectangle([360, 210, 1560, 214], fill=GOLD_DIM)
    d.rectangle([360, 880, 1560, 884], fill=GOLD_DIM)
    text_center(d, 250, "BANZAI VEGAS", font(BOLD, 120), GOLD)
    text_center(d, 420, "On-chain raffle on the QoreChain testnet", font(REG, 46), WHITE)
    text_center(d, 500, "First draw: Sunday, 22 November 2026 at 20:00 UTC", font(BOLD, 44), PURPLE)
    text_center(d, 600, "Try it live:", font(REG, 40), DIM)
    text_center(d, 660, "agusher21.github.io/banzai-vegas-qorechain", font(MONO, 48), GOLD)
    text_center(d, 740, "github.com/agusher21/banzai-vegas-qorechain", font(MONO, 40), DIM)
    text_center(d, 920, "Testnet only — no real funds.", font(REG, 36), DIM)
    img.save("/home/hatch/workspace/banzai-vegas-qorechain/demo-video/closing.png")
    print("wrote closing.png")


if __name__ == "__main__":
    main()
