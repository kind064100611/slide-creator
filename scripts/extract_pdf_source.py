#!/usr/bin/env python3
"""Extract source text and embedded images from a PDF without printing binary data."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import tempfile
from pathlib import Path

from pypdf import PdfReader


def safe_extension(name: str, image_format: str | None) -> str:
    extension = Path(name).suffix.lower()
    if re.fullmatch(r"\.[a-z0-9]{1,5}", extension):
        return extension
    return "." + (image_format or "bin").lower()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()

    source = args.pdf.expanduser().resolve(strict=True)
    output_dir = args.output_dir or Path(tempfile.mkdtemp(prefix="slide-creator-pdf-"))
    output_dir.mkdir(parents=True, exist_ok=True)
    image_dir = output_dir / "images"
    image_dir.mkdir(exist_ok=True)

    reader = PdfReader(str(source))
    text_parts: list[str] = []
    pages: list[dict[str, object]] = []
    images: list[dict[str, object]] = []
    extracted_by_digest: dict[str, dict[str, object]] = {}

    for page_index, page in enumerate(reader.pages, start=1):
        page_text = page.extract_text() or ""
        text_parts.append(f"## PDF page {page_index}\n\n{page_text.strip()}\n")
        page_image_indexes: list[int] = []

        for image_index, source_image in enumerate(page.images, start=1):
            data = source_image.data
            digest = hashlib.sha256(data).hexdigest()
            existing = extracted_by_digest.get(digest)
            if existing is not None:
                existing["pages"].append(page_index)
                page_image_indexes.append(int(existing["index"]))
                continue

            pil_image = source_image.image
            width, height = pil_image.size
            extension = safe_extension(source_image.name, pil_image.format)
            image_path = image_dir / f"page-{page_index:03d}-image-{image_index:02d}{extension}"
            image_path.write_bytes(data)
            record: dict[str, object] = {
                "index": len(images),
                "pages": [page_index],
                "path": image_path.resolve().as_posix(),
                "sourceName": source_image.name,
                "mimeType": "image/jpeg" if extension in {".jpg", ".jpeg"} else f"image/{extension[1:]}",
                "width": width,
                "height": height,
                "byteSize": len(data),
                "sha256": digest,
            }
            extracted_by_digest[digest] = record
            images.append(record)
            page_image_indexes.append(int(record["index"]))

        pages.append({"page": page_index, "imageIndexes": page_image_indexes})

    text_path = output_dir / "source.md"
    text_path.write_text("\n".join(text_parts), encoding="utf-8")
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "source": source.as_posix(),
                "pageCount": len(reader.pages),
                "textPath": text_path.resolve().as_posix(),
                "pages": pages,
                "images": images,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(manifest_path.resolve().as_posix())


if __name__ == "__main__":
    main()
