"""Validation helpers for uploaded project ZIP archives.

The validator only reads ZIP metadata.  It never extracts or executes archive
members, which keeps it suitable for use before an upload is persisted.
"""

from __future__ import annotations

import re
import zipfile
from typing import BinaryIO


BLOCKED_DEPENDENCY_FOLDER_NAMES = frozenset({
    "node_modules",
    "venv",
    ".venv",
    "env",
    ".env",
    "myenv",
    "__pycache__",
    ".tox",
    ".nox",
    "__pypackages__",
})
MAX_DISPLAYED_DEPENDENCY_PATHS = 10
DEPENDENCY_FOLDER_MESSAGE = (
    "Your ZIP contains dependency folders: {paths}. Remove these folders, "
    "create a new ZIP, and upload it again."
)


class ZipValidationError(ValueError):
    """A user-correctable ZIP upload validation error."""


class InvalidZipError(ZipValidationError):
    """The uploaded bytes are not a readable ZIP archive."""


class EmptyZipError(ZipValidationError):
    """The uploaded ZIP contains no entries."""


def normalize_archive_path(name: str) -> str:
    """Normalize ZIP separators while retaining a relative archive path."""

    return re.sub(r"/+", "/", name.replace("\\", "/")).lstrip("/")


def _archive_components(name: str) -> tuple[str, ...]:
    normalized = normalize_archive_path(name)
    return tuple(component for component in normalized.split("/") if component)


def _display_paths(paths: set[str]) -> list[str]:
    return sorted(paths, key=lambda path: (path.casefold(), path))


def format_dependency_folder_message(paths: list[str] | set[str]) -> str:
    unique_paths = _display_paths(set(paths))
    shown = unique_paths[:MAX_DISPLAYED_DEPENDENCY_PATHS]
    remaining = len(unique_paths) - len(shown)
    if remaining:
        shown.append(f"and {remaining} more")
    return DEPENDENCY_FOLDER_MESSAGE.format(paths=", ".join(shown))


def find_dependency_folders(names: list[str]) -> list[str]:
    """Return blocked folder paths found in ZIP entry names.

    Directory components are inferred from file paths, so this also catches
    dependency folders that have no explicit directory entry in the archive.
    A ``pyvenv.cfg`` entry marks its containing folder as a custom virtual
    environment; at the archive root the containing path is represented by
    ``.``.
    """

    detected: dict[str, str] = {}

    def add_detected(path: str) -> None:
        # Archive paths are treated as case-insensitive for matching and
        # display deduplication, just like the blocked folder names.
        detected.setdefault(path.casefold(), path)

    for raw_name in names:
        normalized = normalize_archive_path(raw_name)
        if not normalized:
            continue
        components = _archive_components(normalized)
        if not components:
            continue

        is_directory = normalized.endswith("/")
        folder_components = components if is_directory else components[:-1]
        for index, component in enumerate(folder_components):
            if component.casefold() in BLOCKED_DEPENDENCY_FOLDER_NAMES:
                add_detected("/".join(folder_components[: index + 1]))

        if not is_directory and components[-1].casefold() == "pyvenv.cfg":
            containing = components[:-1]
            add_detected("/".join(containing) if containing else ".")

    return _display_paths(set(detected.values()))


def validate_zip_stream(stream: BinaryIO) -> None:
    """Validate a seekable ZIP stream and rewind it before returning/raising."""

    stream.seek(0)
    try:
        try:
            with zipfile.ZipFile(stream) as archive:
                names = [info.filename for info in archive.infolist()]
        except (zipfile.BadZipFile, EOFError, OSError, ValueError) as exc:
            raise InvalidZipError(
                "Invalid or unsupported archive. Only ZIP files are supported."
            ) from exc

        if not names:
            raise EmptyZipError("The ZIP archive is empty.")

        detected = find_dependency_folders(names)
        if detected:
            raise ZipValidationError(format_dependency_folder_message(detected))
    finally:
        stream.seek(0)
