from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from zip_validation import (
    EmptyZipError,
    InvalidZipError,
    ZipValidationError,
    find_dependency_folders,
    validate_zip_stream,
)


def make_zip(*entries: tuple[str, bytes | None]) -> BytesIO:
    stream = BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, content in entries:
            if content is None:
                archive.writestr(name, b"")
            else:
                archive.writestr(name, content)
    stream.seek(0)
    return stream


def test_source_files_and_dependency_manifests_are_allowed():
    names = [
        "src/environment.ts",
        "venv_notes.md",
        ".env",
        "package.json",
        "package-lock.json",
        "requirements.txt",
        "pyproject.toml",
        "Pipfile",
        "poetry.lock",
    ]
    assert find_dependency_folders(names) == []
    validate_zip_stream(make_zip(*[(name, b"source") for name in names]))


def test_nested_dependency_folder_without_directory_entry_is_rejected():
    stream = make_zip(("project/SRC/NoDe_Modules/pkg/index.js", b"code"))
    with pytest.raises(ZipValidationError, match="project/SRC/NoDe_Modules"):
        validate_zip_stream(stream)
    assert stream.tell() == 0


def test_explicit_empty_dependency_folder_is_rejected():
    with pytest.raises(ZipValidationError, match="project/ENV"):
        validate_zip_stream(make_zip(("project/ENV/", None)))


def test_custom_virtual_environment_and_root_virtual_environment_are_rejected():
    assert find_dependency_folders(["project/.python-custom/pyvenv.cfg"]) == [
        "project/.python-custom"
    ]
    assert find_dependency_folders([r"project\custom-env\pyvenv.cfg"]) == [
        "project/custom-env"
    ]
    assert find_dependency_folders(["pyvenv.cfg"]) == ["."]


def test_multiple_paths_are_deduplicated_and_blocked_names_match_components_only():
    names = [
        "app/node_modules/a.js",
        "app/NODE_MODULES/b.js",
        "app/env/empty/",
        "app/environment.ts",
        "app/venv_notes.md",
    ]
    assert find_dependency_folders(names) == ["app/env", "app/node_modules"]


def test_invalid_and_empty_archives_are_rejected_and_stream_is_rewound():
    empty_stream = make_zip()
    with pytest.raises(EmptyZipError):
        validate_zip_stream(empty_stream)
    assert empty_stream.tell() == 0

    invalid_stream = BytesIO(b"not a zip")
    with pytest.raises(InvalidZipError):
        validate_zip_stream(invalid_stream)
    assert invalid_stream.tell() == 0
