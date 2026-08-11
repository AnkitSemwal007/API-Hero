#!/usr/bin/env python3
"""Generate README MCP workflow GIF matching existing workflow_qsb5jj.gif style.

Reference: 960x540, palette GIF, ~5 frames @ 1400ms, ~240KB, dark teal chrome.
Output: images/marketplace/api-hero-mcp.gif (gitignored local staging).
Upload to Cloudinary as public ID api-hero-mcp_hrx7xa for README CDN embedding.

Requires Pillow. Default fonts are Windows Segoe UI / Consolas paths; on other
OS platforms, edit font() / mono() to point at local TTF files.
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "images" / "marketplace"
OUT_PATH = OUT_DIR / "api-hero-mcp.gif"
ICON_PATH = ROOT / "images" / "icon.png"

W, H = 960, 540
DURATION_MS = 1400
TEAL = (15, 118, 110)  # #0f766e gallery banner
TEAL_BRIGHT = (45, 212, 191)  # cyan accent
TEAL_SOFT = (20, 84, 80)
BG = (10, 16, 24)
BG_PANEL = (18, 26, 36)
BG_CARD = (24, 34, 46)
BG_CHAT = (15, 22, 32)
BORDER = (42, 56, 72)
TEXT = (230, 237, 243)
TEXT_DIM = (148, 163, 184)
TEXT_MUTED = (100, 116, 139)
GREEN = (52, 211, 153)
RED = (248, 113, 113)
AMBER = (251, 191, 36)
WHITE = (255, 255, 255)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf"
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def mono(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(r"C:\Windows\Fonts\consola.ttf", size)
    except OSError:
        return font(size)


def rounded_rect(draw: ImageDraw.ImageDraw, xy, radius: int, fill, outline=None, width: int = 1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def draw_background(img: Image.Image) -> None:
    """Dark cinematic wash with subtle teal glow (matches promo frame mood)."""
    px = img.load()
    for y in range(H):
        for x in range(W):
            # vertical gradient + soft teal vignette toward bottom
            t = y / H
            r = int(10 + 4 * t)
            g = int(16 + 18 * t)
            b = int(24 + 22 * t)
            # bottom teal glow
            glow = max(0.0, (y - 380) / 160.0)
            g = min(255, int(g + 40 * glow))
            b = min(255, int(b + 35 * glow))
            # side vignette
            vx = min(x, W - 1 - x) / (W / 2)
            shade = 0.75 + 0.25 * vx
            px[x, y] = (int(r * shade), int(g * shade), int(b * shade))


def paste_icon(base: Image.Image, xy: tuple[int, int], size: int = 28) -> None:
    if not ICON_PATH.exists():
        return
    icon = Image.open(ICON_PATH).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)
    base.paste(icon, xy, icon)


def header(base: Image.Image, subtitle: str) -> None:
    draw = ImageDraw.Draw(base)
    paste_icon(base, (24, 16), 32)
    draw.text((66, 18), "API HERO", font=font(22, bold=True), fill=WHITE)
    draw.text((66, 42), subtitle, font=font(14), fill=TEAL_BRIGHT)
    # slim teal rule
    draw.rectangle((24, 68, W - 24, 70), fill=TEAL)


def flow_pills(draw: ImageDraw.ImageDraw, active: int) -> None:
    labels = ["Codex", "MCP", "Discover", "Run", "Result"]
    x = 24
    y = 84
    for i, label in enumerate(labels):
        tw = draw.textlength(label, font=font(12, bold=True))
        pad = 14
        w = int(tw + pad * 2)
        fill = TEAL if i == active else BG_CARD
        outline = TEAL_BRIGHT if i == active else BORDER
        rounded_rect(draw, (x, y, x + w, y + 26), 8, fill, outline, 1)
        color = WHITE if i == active else TEXT_DIM
        draw.text((x + pad, y + 4), label, font=font(12, bold=True), fill=color)
        x += w + 8
        if i < len(labels) - 1:
            draw.text((x - 6, y + 3), "→", font=font(14, bold=True), fill=TEAL_BRIGHT)
            x += 10


def panel(draw: ImageDraw.ImageDraw, xy, title: str | None = None) -> None:
    rounded_rect(draw, xy, 12, BG_PANEL, BORDER, 1)
    if title:
        x0, y0, x1, _ = xy
        draw.text((x0 + 16, y0 + 12), title, font=font(13, bold=True), fill=TEXT_DIM)


def tool_chip(draw: ImageDraw.ImageDraw, xy, name: str) -> None:
    x, y = xy
    tw = draw.textlength(name, font=mono(12))
    rounded_rect(draw, (x, y, x + tw + 20, y + 24), 6, TEAL_SOFT, TEAL, 1)
    draw.text((x + 10, y + 3), name, font=mono(12), fill=TEAL_BRIGHT)


def frame_intro() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw = ImageDraw.Draw(img)
    header(img, "MCP for AI agents")
    flow_pills(draw, 0)

    # Center flow diagram
    boxes = [
        (80, 180, 260, 280, "AI Agent / Codex"),
        (350, 180, 530, 280, "API Hero MCP"),
        (620, 180, 880, 280, "Execution Engine"),
    ]
    for i, (x0, y0, x1, y1, label) in enumerate(boxes):
        rounded_rect(draw, (x0, y0, x1, y1), 14, BG_CARD, TEAL if i == 1 else BORDER, 2)
        draw.text((x0 + 20, y0 + 36), label, font=font(16, bold=True), fill=WHITE)
        sub = ["asks MCP tools", "stdio · apihero_*", "Collection Runner"][i]
        draw.text((x0 + 20, y0 + 64), sub, font=font(13), fill=TEXT_DIM)
    for x in (270, 540):
        draw.polygon([(x, 220), (x + 24, 230), (x, 240)], fill=TEAL_BRIGHT)

    draw.text(
        (80, 320),
        "AI agents use API Hero as a real API execution & diagnostics tool through MCP.",
        font=font(15),
        fill=TEXT,
    )
    draw.text(
        (80, 352),
        "Not a second HTTP client — same Collection Runner + Execution Orchestrator.",
        font=font(13),
        fill=TEXT_MUTED,
    )

    # Bottom steps preview
    steps = [
        "1  list collections",
        "2  run Get Products",
        "3  HTTP 200 + JSON",
        "4  assertion diagnostics",
    ]
    x = 80
    for s in steps:
        tw = draw.textlength(s, font=mono(12))
        rounded_rect(draw, (x, 420, x + tw + 24, 452), 8, BG_CHAT, BORDER, 1)
        draw.text((x + 12, 426), s, font=mono(12), fill=TEAL_BRIGHT)
        x += tw + 36
    return img


def frame_list_collections() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw = ImageDraw.Draw(img)
    header(img, "Codex  ·  MCP tool call")
    flow_pills(draw, 1)

    # Left: Codex chat
    panel(draw, (24, 128, 470, 510), "Codex")
    draw.text((40, 160), "You", font=font(12, bold=True), fill=TEXT_MUTED)
    rounded_rect(draw, (40, 180, 450, 230), 10, BG_CHAT, BORDER, 1)
    draw.text((52, 192), "List the API Hero collections in this workspace.", font=font(14), fill=TEXT)

    draw.text((40, 250), "Tool", font=font(12, bold=True), fill=TEAL_BRIGHT)
    tool_chip(draw, (40, 270), "apihero_list_collections")
    draw.text((40, 310), "args: {}", font=mono(12), fill=TEXT_MUTED)

    draw.text((40, 350), "API Hero MCP", font=font(12, bold=True), fill=TEXT_MUTED)
    rounded_rect(draw, (40, 370, 450, 480), 10, (12, 40, 38), TEAL, 1)
    draw.text((52, 384), "ok: true", font=mono(13), fill=GREEN)
    draw.text((52, 408), 'collections: [', font=mono(13), fill=TEXT_DIM)
    draw.text((68, 432), '{ name: "DummyJSON Complete', font=mono(13), fill=WHITE)
    draw.text((68, 452), '  API Collection", ... }', font=mono(13), fill=WHITE)

    # Right: pipeline
    panel(draw, (490, 128, 936, 510), "Pipeline")
    nodes = [
        (520, 180, "AI Client / Codex"),
        (520, 250, "API Hero MCP"),
        (520, 320, "Discover collections"),
        (520, 390, "Filesystem Collections/"),
    ]
    for i, (x, y, label) in enumerate(nodes):
        rounded_rect(draw, (x, y, 900, y + 48), 10, BG_CARD, TEAL_BRIGHT if i == 2 else BORDER, 1)
        draw.text((x + 16, y + 12), label, font=font(14, bold=True), fill=WHITE)
        if i < len(nodes) - 1:
            draw.line((710, y + 48, 710, y + 70), fill=TEAL_BRIGHT, width=2)
    return img


def frame_discover_result() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw = ImageDraw.Draw(img)
    header(img, "Discover  ·  DummyJSON Complete API Collection")
    flow_pills(draw, 2)

    panel(draw, (24, 128, 936, 510))
    draw.text((48, 150), "apihero_list_collections  →  result", font=font(14, bold=True), fill=TEXT_DIM)
    rounded_rect(draw, (48, 186, 912, 290), 12, BG_CARD, TEAL, 2)
    paste_icon(img, (68, 214), 40)
    draw.text((120, 210), "DummyJSON Complete API Collection", font=font(20, bold=True), fill=WHITE)
    draw.text((120, 244), "kind: collection   ·   requests ready for MCP run", font=font(14), fill=TEXT_DIM)

    draw.text((48, 320), "Next: run a request from this collection", font=font(14), fill=TEXT)
    tool_chip(draw, (48, 356), "apihero_run_request")
    draw.text((48, 400), 'collection: "DummyJSON Complete API Collection"', font=mono(13), fill=TEXT_DIM)
    draw.text((48, 426), 'request: "Get Products"', font=mono(13), fill=TEXT_DIM)
    draw.text((48, 460), "API Hero MCP reuses Collection Runner + Execution Orchestrator", font=font(13), fill=TEAL_BRIGHT)
    return img


def frame_run_request() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw = ImageDraw.Draw(img)
    header(img, "Run  ·  Get Products")
    flow_pills(draw, 3)

    # Chat column
    panel(draw, (24, 128, 430, 510), "Codex")
    draw.text((40, 160), "You", font=font(12, bold=True), fill=TEXT_MUTED)
    rounded_rect(draw, (40, 180, 410, 250), 10, BG_CHAT, BORDER, 1)
    draw.text((52, 192), "Run Get Products from the", font=font(14), fill=TEXT)
    draw.text((52, 214), "DummyJSON Complete API Collection.", font=font(14), fill=TEXT)

    tool_chip(draw, (40, 270), "apihero_run_request")
    draw.text((40, 310), "Executing via API Hero…", font=font(13), fill=AMBER)

    # Execution column
    panel(draw, (450, 128, 936, 510), "API Hero Execution Engine")
    rounded_rect(draw, (470, 170, 916, 230), 10, BG_CARD, BORDER, 1)
    draw.text((486, 178), "GET", font=font(14, bold=True), fill=TEAL_BRIGHT)
    draw.text((530, 178), "{{baseUrl}}/products", font=mono(14), fill=TEXT)
    draw.text((486, 204), "@name Get Products   ·   DummyJSON Complete API Collection", font=font(12), fill=TEXT_MUTED)

    steps = [
        ("1", "Parse / validate .api request", True),
        ("2", "Resolve variables", True),
        ("3", "HTTP via Node transport", True),
        ("4", "Assertions + result projection", False),
    ]
    y = 260
    for num, label, done in steps:
        color = GREEN if done else AMBER
        rounded_rect(draw, (470, y, 916, y + 40), 8, BG_CHAT, BORDER, 1)
        draw.ellipse((486, y + 10, 510, y + 34), fill=color)
        draw.text((490, y + 12), num, font=font(12, bold=True), fill=BG)
        draw.text((526, y + 10), label, font=font(14), fill=TEXT)
        y += 50
    return img


def frame_success_response() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw = ImageDraw.Draw(img)
    header(img, "Result  ·  HTTP 200")
    flow_pills(draw, 4)

    panel(draw, (24, 128, 936, 510))
    # Status bar
    rounded_rect(draw, (48, 156, 912, 220), 12, BG_CARD, TEAL, 2)
    draw.text((68, 168), "200 OK", font=font(28, bold=True), fill=GREEN)
    draw.text((220, 180), "Get Products   ·   142 ms   ·   apihero_run_request", font=font(14), fill=TEXT_DIM)

    draw.text((48, 246), "Response body (excerpt)", font=font(13, bold=True), fill=TEXT_MUTED)
    rounded_rect(draw, (48, 272, 912, 470), 12, (12, 18, 28), BORDER, 1)
    lines = [
        "{",
        '  "products": [',
        '    { "id": 1, "title": "Essence Mascara...", "price": 9.99 },',
        '    { "id": 2, "title": "Eyeshadow Palette...", "price": 19.99 },',
        '    { "id": 3, "title": "Powder Canister", "price": 14.99 }',
        "  ],",
        '  "total": 194, "skip": 0, "limit": 30',
        "}",
    ]
    y = 288
    for line in lines:
        draw.text((68, y), line, font=mono(13), fill=TEXT)
        y += 22
    return img


def frame_assertion_failure() -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    draw_background(img)
    draw = ImageDraw.Draw(img)
    header(img, "Diagnostics  ·  assertion failure")
    flow_pills(draw, 4)

    # Left: structured failure
    panel(draw, (24, 128, 470, 510), "API Hero MCP result")
    rounded_rect(draw, (40, 168, 454, 230), 10, BG_CARD, RED, 2)
    draw.text((56, 180), "HTTP 201 Created", font=font(18, bold=True), fill=AMBER)
    draw.text((56, 208), "Request sent  ·  response received", font=font(13), fill=TEXT_DIM)

    rounded_rect(draw, (40, 250, 454, 400), 10, (40, 18, 22), RED, 1)
    draw.text((56, 266), "category: assertion", font=mono(14), fill=RED)
    draw.text((56, 296), "Expected: 200", font=mono(14), fill=TEXT)
    draw.text((56, 324), "Actual:   201", font=mono(14), fill=TEXT)
    draw.text((56, 356), "expect status == 200  →  failed", font=mono(13), fill=TEXT_DIM)

    draw.text((40, 424), "Structured diagnostics for agents —", font=font(13), fill=TEXT_MUTED)
    draw.text((40, 448), "not just a raw HTTP dump.", font=font(13), fill=TEXT_MUTED)

    # Right: AI explanation
    panel(draw, (490, 128, 936, 510), "Codex")
    draw.text((510, 160), "Assistant", font=font(12, bold=True), fill=TEAL_BRIGHT)
    rounded_rect(draw, (510, 180, 916, 470), 12, BG_CHAT, BORDER, 1)
    explanation = [
        "The API request succeeded (HTTP 201),",
        "but the assertion failed.",
        "",
        "API Hero reported:",
        "  • category: assertion",
        "  • Expected: 200",
        "  • Actual: 201",
        "",
        "So the call reached the server and returned",
        "a body — the test expectation did not match.",
    ]
    y = 198
    for line in explanation:
        draw.text((528, y), line, font=font(14), fill=TEXT)
        y += 24
    return img


def quantize(img: Image.Image) -> Image.Image:
    """Adaptive palette similar to reference GIF."""
    return img.convert("P", palette=Image.Palette.ADAPTIVE, colors=128)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    frames_rgb = [
        frame_intro(),
        frame_list_collections(),
        frame_discover_result(),
        frame_run_request(),
        frame_success_response(),
        frame_assertion_failure(),
    ]
    frames = [quantize(f) for f in frames_rgb]
    frames[0].save(
        OUT_PATH,
        save_all=True,
        append_images=frames[1:],
        duration=DURATION_MS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    size = OUT_PATH.stat().st_size
    print(f"wrote {OUT_PATH}")
    print(f"frames={len(frames)} size={size} dims={W}x{H} duration_ms={DURATION_MS}")


if __name__ == "__main__":
    main()
