"""Utilities for release licensing metadata and rendering."""
from __future__ import annotations

from dataclasses import dataclass
from textwrap import dedent
from typing import Optional, Sequence

CUSTOM_LICENSE_CODE = "CUSTOM"


@dataclass(frozen=True)
class LicenseInfo:
    code: str
    label: str
    url: Optional[str]
    body: str


_LICENSES: dict[str, LicenseInfo] = {
    "MIT": LicenseInfo(
        code="MIT",
        label="MIT License",
        url="https://opensource.org/license/mit/",
        body=dedent(
            """
            Copyright (c) <year> <copyright holders>

            Permission is hereby granted, free of charge, to any person obtaining a copy
            of this software and associated documentation files (the "Software"), to deal
            in the Software without restriction, including without limitation the rights
            to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
            copies of the Software, and to permit persons to whom the Software is
            furnished to do so, subject to the following conditions:

            The above copyright notice and this permission notice shall be included in all
            copies or substantial portions of the Software.

            THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
            IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
            FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
            AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
            LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
            OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
            SOFTWARE.
            """
        ).strip(),
    ),
    "Apache-2.0": LicenseInfo(
        code="Apache-2.0",
        label="Apache License 2.0",
        url="https://www.apache.org/licenses/LICENSE-2.0",
        body=dedent(
            """
            Licensed under the Apache License, Version 2.0 (the "License");
            you may not use this work except in compliance with the License.
            You may obtain a copy of the License at

                http://www.apache.org/licenses/LICENSE-2.0

            Unless required by applicable law or agreed to in writing, software
            distributed under the License is distributed on an "AS IS" BASIS,
            WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
            See the License for the specific language governing permissions and
            limitations under the License.
            """
        ).strip(),
    ),
    "CC-BY-4.0": LicenseInfo(
        code="CC-BY-4.0",
        label="Creative Commons Attribution 4.0 International",
        url="https://creativecommons.org/licenses/by/4.0/",
        body=dedent(
            """
            This release is shared under the Creative Commons Attribution 4.0 International
            (CC BY 4.0) license. You are free to share and adapt the material for any
            purpose, even commercially, provided that you give appropriate credit, provide
            a link to the license, and indicate if changes were made.

            No additional restrictions — you may not apply legal terms or technological
            measures that legally restrict others from doing anything the license permits.
            """
        ).strip(),
    ),
}

SUPPORTED_LICENSE_CODES: Sequence[str] = tuple(sorted(tuple(_LICENSES.keys()) + (CUSTOM_LICENSE_CODE,)))


def normalize_license_code(code: Optional[str]) -> Optional[str]:
    if code is None:
        return None
    normalized = code.strip()
    if not normalized:
        return None
    lowered = normalized.lower()
    for candidate in _LICENSES:
        if lowered == candidate.lower():
            return candidate
    if lowered == CUSTOM_LICENSE_CODE.lower():
        return CUSTOM_LICENSE_CODE
    return normalized


def is_supported_license_code(code: Optional[str]) -> bool:
    normalized = normalize_license_code(code)
    if not normalized:
        return False
    if normalized == CUSTOM_LICENSE_CODE:
        return True
    return normalized in _LICENSES


def get_license_info(code: Optional[str]) -> Optional[LicenseInfo]:
    normalized = normalize_license_code(code)
    if not normalized:
        return None
    return _LICENSES.get(normalized)


def render_license_md(release) -> Optional[str]:
    """Return the markdown content for the release license, if available."""
    code = normalize_license_code(getattr(release, "license_code", None))
    if not code:
        return None

    if code == CUSTOM_LICENSE_CODE:
        custom_text = getattr(release, "license_custom_text", None)
        if not custom_text:
            return None
        text = custom_text.strip()
        if not text:
            return None
        if not text.startswith("#"):
            text = f"# Custom License\n\n{text}"
        if not text.endswith("\n"):
            text += "\n"
        return text

    info = get_license_info(code)
    if not info:
        return None

    sections: list[str] = [f"# {info.label}"]
    body = info.body.strip()
    if body:
        sections.extend(["", body])
    if info.url:
        sections.extend(["", f"Reference: {info.url}"])
    content = "\n".join(sections)
    if not content.endswith("\n"):
        content += "\n"
    return content


__all__ = [
    "CUSTOM_LICENSE_CODE",
    "LicenseInfo",
    "SUPPORTED_LICENSE_CODES",
    "get_license_info",
    "is_supported_license_code",
    "normalize_license_code",
    "render_license_md",
]
