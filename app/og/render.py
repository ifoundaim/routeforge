from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Iterable, Optional, Sequence

from PIL import Image, ImageDraw, ImageFont


WIDTH = 1200
HEIGHT = 630
PADDING = 72
BRAND_BG = (12, 20, 38)
CARD_BG = (21, 31, 56)
ACCENT = (96, 165, 250)
TEXT_PRIMARY = (241, 245, 249)
TEXT_SUBTLE = (148, 163, 184)
BADGE_BG = (30, 64, 175)
BADGE_TEXT = (226, 232, 240)
NOT_FOUND_BG = (120, 53, 15)


@dataclass(frozen=True)
class ReleaseOgInput:
    project_name: str
    release_version: str
    license_label: Optional[str] = None
    summary: Optional[str] = None


def _iter_font_candidates(weight: str) -> Iterable[str]:
    if weight == "bold":
        yield from (
            "Inter-Bold.ttf",
            "Inter-SemiBold.ttf",
            "Inter-Bold.otf",
            "SF-Pro-Display-Bold.otf",
            "SFProDisplay-Bold.ttf",
            "HelveticaNeue-Bold.ttf",
            "Helvetica-Bold.ttf",
            "Arial Bold.ttf",
            "Arial-Bold.ttf",
            "Arial Unicode.ttf",
            "Verdana-Bold.ttf",
            "DejaVuSans-Bold.ttf",
        )
    else:
        yield from (
            "Inter-Regular.ttf",
            "Inter-Medium.ttf",
            "Inter-Regular.otf",
            "SF-Pro-Display-Regular.otf",
            "SFProDisplay-Regular.ttf",
            "HelveticaNeue.ttf",
            "Helvetica.ttf",
            "Arial.ttf",
            "Verdana.ttf",
            "DejaVuSans.ttf",
        )


def _load_font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont | ImageFont.BitmapFont:
    for name in _iter_font_candidates(weight):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, max_width: int, *, max_lines: int = 3) -> Sequence[str]:
    words = text.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join(current + [word]) if current else word
        width, _ = _text_size(draw, candidate, font)
        if width <= max_width:
            current.append(word)
            continue
        if current:
            lines.append(" ".join(current))
            current = [word]
        else:
            lines.append(word)
        if len(lines) >= max_lines:
            break
    if len(lines) < max_lines and current:
        lines.append(" ".join(current))
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if len(lines) == max_lines and words and (len(words) > sum(len(line.split()) for line in lines)):
        lines[-1] = lines[-1].rstrip(" .,") + "…"
    return lines


def _draw_badge(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, *, align_right: bool = True) -> None:
    if not text:
        return
    pad_x = 32
    pad_y = 18
    text_width, text_height = _text_size(draw, text, font)
    badge_w = text_width + (pad_x * 2)
    badge_h = text_height + (pad_y * 2)
    if align_right:
        badge_x = WIDTH - PADDING - badge_w
    else:
        badge_x = PADDING
    badge_y = PADDING
    draw.rounded_rectangle(
        [badge_x, badge_y, badge_x + badge_w, badge_y + badge_h], radius=24, fill=BADGE_BG
    )
    draw.text((badge_x + pad_x, badge_y + pad_y), text, font=font, fill=BADGE_TEXT)


def _draw_summary(draw: ImageDraw.ImageDraw, summary: str, font: ImageFont.ImageFont, start_y: int) -> int:
    max_width = WIDTH - (2 * PADDING)
    lines = _wrap_text(draw, summary, font, max_width, max_lines=3)
    y = start_y
    for line in lines:
        draw.text((PADDING, y), line, font=font, fill=TEXT_SUBTLE)
        _, height = _text_size(draw, line, font)
        y += height + 10
    return y


def _render_base(background: tuple[int, int, int]) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    image = Image.new("RGB", (WIDTH, HEIGHT), color=background)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle([
        PADDING - 24,
        PADDING - 16,
        WIDTH - PADDING + 24,
        HEIGHT - PADDING + 16,
    ], radius=48, fill=CARD_BG)
    return image, draw


def render_release_image(data: ReleaseOgInput) -> bytes:
    image, draw = _render_base(BRAND_BG)

    header_font = _load_font(48, weight="bold")
    title_font = _load_font(80, weight="bold")
    version_font = _load_font(44)
    summary_font = _load_font(36)
    badge_font = _load_font(36, weight="bold")

    draw.text((PADDING, PADDING), "RouteForge", font=header_font, fill=ACCENT)

    if data.license_label:
        _draw_badge(draw, data.license_label, badge_font)

    title_lines = _wrap_text(draw, data.project_name, title_font, WIDTH - (2 * PADDING), max_lines=2)
    y = PADDING + _text_size(draw, "RouteForge", header_font)[1] + 40
    for line in title_lines:
        draw.text((PADDING, y), line, font=title_font, fill=TEXT_PRIMARY)
        _, line_height = _text_size(draw, line, title_font)
        y += line_height + 10

    version_text = f"Version {data.release_version}" if data.release_version else ""
    if version_text:
        draw.text((PADDING, y + 16), version_text, font=version_font, fill=TEXT_SUBTLE)
        _, version_height = _text_size(draw, version_text, version_font)
        y += version_height + 48
    else:
        y += 32

    if data.summary:
        y = _draw_summary(draw, data.summary, summary_font, y)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def render_not_found_image(release_id: Optional[int] = None) -> bytes:
    image, draw = _render_base(BRAND_BG)

    header_font = _load_font(48, weight="bold")
    title_font = _load_font(86, weight="bold")
    body_font = _load_font(38)

    draw.text((PADDING, PADDING), "RouteForge", font=header_font, fill=ACCENT)

    message = "Release Not Found"
    draw.text((PADDING, HEIGHT / 2 - 60), message, font=title_font, fill=TEXT_PRIMARY)

    if release_id is not None:
        detail = f"No release with id {release_id} is available."
        draw.text((PADDING, HEIGHT / 2 + 30), detail, font=body_font, fill=TEXT_SUBTLE)

    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
