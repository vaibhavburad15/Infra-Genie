"""
Deterministic static repository analyzer — no LLM required.

Inputs:
  - a directory on disk (already cloned repo OR extracted ZIP)
  - or a zip path

Output: a deterministic `DetailedAnalysis` dict that the UI shows to the user
even when the LLM is unavailable / offline. The orchestrator then passes this
into every specialist agent's prompt, so the LLM's reasoning is *augmentation*
on top of reliable detection — not primary detection (which used to hallucinate).

We deliberately use exact string matches against known dependency names rather
than embedding/ML — the whole point is to never guess. If a tool isn't
recognised, it is omitted; if the user wants better coverage, they can suggest
additions to FRAMEWORK_SIGNATURES below.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Any

# Files we never read (noise / large).
SKIP_DIRS = frozenset({
    ".git", "node_modules", "dist", "build", ".next", ".nuxt", ".output",
    "__pycache__", ".venv", "venv", "env", ".idea", ".vscode", ".cache",
    "coverage", "target", "vendor", "Pods", "bin", "obj", ".gradle",
    "site-packages", ".terraform", ".pulumi", "out", "tmp", "logs",
    # ML / data projects routinely ship huge generated dirs — never scan them
    "datasets", "dataset", "data", "models", "model", "weights", "checkpoints",
    "weights_backup", "audio_files", "cross_validation", "infragenie_",
})

# File category → leading dot for fast filter.
LANG_EXT = {
    ".py": "Python", ".js": "JavaScript", ".jsx": "JavaScript",
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin",
    ".rb": "Ruby", ".php": "PHP", ".cs": "C#",
    ".swift": "Swift", ".m": "Objective-C", ".mm": "Objective-C++",
    ".c": "C", ".cpp": "C++", ".cc": "C++", ".h": "C/C++ Header",
    ".scala": "Scala", ".dart": "Dart", ".lua": "Lua", ".r": "R",
    ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell",
    ".ex": "Elixir", ".exs": "Elixir", ".clj": "Clojure",
    ".html": "HTML", ".htm": "HTML",
    ".vue": "Vue SFC", ".svelte": "Svelte",
    ".css": "CSS", ".scss": "SCSS", ".sass": "Sass", ".less": "Less",
    ".sql": "SQL", ".proto": "Protobuf",
    ".md": "Markdown", ".json": "JSON", ".yaml": "YAML", ".yml": "YAML",
    ".toml": "TOML", ".ini": "INI", ".xml": "XML",
}
TEXT_LIKE = frozenset(LANG_EXT.keys())

# dependency-name → (display-name, category). Categories: framework | build |
# test | lint | runtime | db | cloud | cicd | tooling.
FRAMEWORK_SIGNATURES: dict[str, tuple[str, str]] = {
    # ── JS / TS frameworks ──────────────────────────────────────────────────
    "react": ("React", "framework"), "react-dom": ("React", "framework"),
    "next": ("Next.js", "framework"), "nuxt": ("Nuxt", "framework"),
    "vue": ("Vue.js", "framework"), "@angular/core": ("Angular", "framework"),
    "@angular/cli": ("Angular CLI", "framework"),
    "svelte": ("Svelte", "framework"), "@sveltejs/kit": ("SvelteKit", "framework"),
    "@remix-run/react": ("Remix", "framework"),
    "@remix-run/node": ("Remix", "framework"),
    "gatsby": ("Gatsby", "framework"),
    "astro": ("Astro", "framework"),
    "solid-js": ("Solid.js", "framework"),
    "preact": ("Preact", "framework"),
    "react-native": ("React Native", "framework"),
    "express": ("Express.js", "framework"), "fastify": ("Fastify", "framework"),
    "@nestjs/core": ("NestJS", "framework"), "nestjs": ("NestJS", "framework"),
    "koa": ("Koa", "framework"), "hapi": ("Hapi", "framework"),
    "@hapi/hapi": ("Hapi", "framework"),
    "sails": ("Sails.js", "framework"),
    "socket.io": ("Socket.IO", "framework"),
    "electron": ("Electron", "framework"),
    "@tauri-apps/api": ("Tauri", "framework"),
    # ── Python frameworks ───────────────────────────────────────────────────
    "django": ("Django", "framework"), "flask": ("Flask", "framework"),
    "fastapi": ("FastAPI", "framework"), "starlette": ("Starlette", "framework"),
    "uvicorn": ("Uvicorn (ASGI)", "framework"),
    "gunicorn": ("Gunicorn (WSGI)", "framework"),
    "celery": ("Celery", "framework"), "rq": ("RQ (queue)", "framework"),
    "dramatiq": ("Dramatiq", "framework"),
    "streamlit": ("Streamlit", "framework"),
    "gradio": ("Gradio", "framework"),
    "pyramid": ("Pyramid", "framework"), "tornado": ("Tornado", "framework"),
    "aiohttp": ("aiohttp", "framework"), "sanic": ("Sanic", "framework"),
    "bottle": ("Bottle", "framework"),
    "tensorflow": ("TensorFlow", "framework"),
    "pytorch": ("PyTorch", "framework"), "torch": ("PyTorch", "framework"),
    "sklearn": ("scikit-learn", "framework"),
    "pandas": ("Pandas", "framework"), "numpy": ("NumPy", "framework"),
    # ── Ruby / Go / Java frameworks ─────────────────────────────────────────
    "rails": ("Ruby on Rails", "framework"),
    "sinatra": ("Sinatra", "framework"),
    "gin-gonic/gin": ("Gin (Go)", "framework"),
    "echo": ("Echo (Go)", "framework"),
    "fiber": ("Fiber (Go)", "framework"),
    "chi": ("Chi (Go)", "framework"),
    "spring-boot": ("Spring Boot", "framework"),
    "quarkus": ("Quarkus", "framework"),
    "micronaut": ("Micronaut", "framework"),
    # ── Build tools ─────────────────────────────────────────────────────────
    "vite": ("Vite", "build"),
    "webpack": ("webpack", "build"),
    "esbuild": ("esbuild", "build"),
    "rollup": ("Rollup", "build"),
    "parcel": ("Parcel", "build"),
    "turbo": ("Turborepo", "build"),
    "@nrwl/cli": ("Nx", "build"),
    "nx": ("Nx", "build"),
    "gulp": ("Gulp", "build"),
    "grunt": ("Grunt", "build"),
    "ts-loader": ("ts-loader", "build"),
    # ── Test frameworks ─────────────────────────────────────────────────────
    "jest": ("Jest", "test"), "@jest/core": ("Jest", "test"),
    "vitest": ("Vitest", "test"),
    "mocha": ("Mocha", "test"), "chai": ("Chai", "test"),
    "playwright": ("Playwright", "test"),
    "@playwright/test": ("Playwright", "test"),
    "cypress": ("Cypress", "test"),
    "puppeteer": ("Puppeteer", "test"),
    "karma": ("Karma", "test"),
    "@testing-library/react": ("React Testing Library", "test"),
    "@testing-library/jest-dom": ("React Testing Library", "test"),
    "pytest": ("pytest", "test"), "pytest-django": ("pytest-django", "test"),
    "unittest": ("unittest", "test"),
    "rspec": ("RSpec", "test"), "minitest": ("Minitest", "test"),
    "go test": ("go test (builtin)", "test"),
    # ── Linters / formatters ────────────────────────────────────────────────
    "eslint": ("ESLint", "lint"),
    "@typescript-eslint/parser": ("TypeScript ESLint", "lint"),
    "prettier": ("Prettier", "lint"),
    "stylelint": ("Stylelint", "lint"),
    "biome": ("Biome", "lint"),
    "ruff": ("Ruff", "lint"),
    "black": ("Black", "lint"),
    "flake8": ("Flake8", "lint"),
    "pylint": ("Pylint", "lint"),
    "mypy": ("mypy", "lint"),
    "golangci-lint": ("golangci-lint", "lint"),
    # ── Databases / ORMs ────────────────────────────────────────────────────
    "prisma": ("Prisma ORM", "db"), "@prisma/client": ("Prisma Client", "db"),
    "sequelize": ("Sequelize", "db"), "typeorm": ("TypeORM", "db"),
    "mongoose": ("Mongoose", "db"),
    "knex": ("Knex.js", "db"),
    "drizzle-orm": ("Drizzle ORM", "db"),
    "sqlalchemy": ("SQLAlchemy", "db"),
    "psycopg2": ("psycopg2 (Postgres)", "db"),
    "psycopg2-binary": ("psycopg2-binary (Postgres)", "db"),
    "asyncpg": ("asyncpg (Postgres)", "db"),
    "mysqlclient": ("mysqlclient (MySQL)", "db"),
    "pymongo": ("PyMongo (MongoDB)", "db"),
    "motor": ("Motor (MongoDB async)", "db"),
    "redis": ("redis-py (Redis)", "db"),
    "peewee": ("Peewee ORM", "db"),
    "tortoise-orm": ("Tortoise ORM", "db"),
    "gorm": ("GORM (Go)", "db"),
    # ── Cloud / IaC SDKs ────────────────────────────────────────────────────
    "boto3": ("AWS SDK (boto3)", "cloud"),
    "botocore": ("AWS SDK (botocore)", "cloud"),
    "google-cloud": ("Google Cloud SDK", "cloud"),
    "azure-mgmt": ("Azure SDK", "cloud"),
    "cdktf": ("CDK for Terraform", "cloud"),
    "pulumi": ("Pulumi", "cloud"),
    "aws-cdk": ("AWS CDK", "cloud"),
    # ── CI/CD helpers in deps (uncommon; CI is usually file-based) ───────────
}

# Lockfile presence → package manager.
PACKAGE_MANAGERS = [
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "Yarn"),
    ("package-lock.json", "npm"),
    ("bun.lockb", "Bun"),
    ("Pipfile.lock", "Pipenv"),
    ("poetry.lock", "Poetry"),
    ("uv.lock", "uv"),
    ("Cargo.lock", "Cargo"),
    ("go.sum", "Go modules"),
    ("composer.lock", "Composer"),
    ("Gemfile.lock", "Bundler"),
    ("pnpm-workspace.yaml", "pnpm workspaces"),
    ("package.json", "npm"),  # fallback
]

DOCKER_HINTS = {
    "postgres", "mysql", "mariadb", "redis", "mongo", "mongodb",
    "rabbitmq", "kafka", "zookeeper", "elasticsearch", "nginx", "traefik",
    "memcached", "cassandra",
}

# Manifests that the static analyzer inspects first when versions are needed.
VERSION_ORDER_PACKAGE_JSON = ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies")

# Helpers ──────────────────────────────────────────────────────────────────────

def _read_json(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return None


def _read_text(path: Path, limit: int = 200_000) -> str | None:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:limit]
    except Exception:
        return None


def _line_count(path: Path) -> int:
    try:
        n = 0
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                n += chunk.count(b"\n")
        return n
    except Exception:
        return 0


def _pkg_version_key(name: str, version: str) -> tuple[str, str | None]:
    """Normalise ranges like '^1.2.3' or '~1.2.3' to a best-guess version."""
    if not version:
        return name, None
    v = version.strip().lstrip("^~>=< ").split(" ", 1)[0]
    v = v.replace("npm:", "").replace("github:", "")
    # Strip leading 'v'
    if v.startswith("v") and len(v) > 1 and v[1].isdigit():
        v = v[1:]
    return name, v if re.match(r"^\d+(\.\d+)*", v or "") else None


def _extract_versions_from_pkg(pkg: dict) -> dict[str, str]:
    """Return a flat {dep_name: best_version} dict from package.json sections."""
    out: dict[str, str] = {}
    for section in VERSION_ORDER_PACKAGE_JSON:
        deps = pkg.get(section) or {}
        if isinstance(deps, dict):
            for name, ver in deps.items():
                n, v = _pkg_version_key(name, str(ver))
                if v and n not in out:
                    out[n] = v
    return out


def _read_requirements_versions(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("-"):
            continue
        # strip inline comments / extras markers
        line = line.split("#", 1)[0].split(";", 1)[0].strip()
        m = re.match(r"^([A-Za-z0-9_.\-]+)\s*([~=!<>]+\s*[\w.\-+\*]+)?", line)
        if not m:
            continue
        name = m.group(1).lower()
        ver = (m.group(2) or "").lstrip("~=!<> ").strip()
        ver = ver.split(";", 1)[0].strip()
        if name and name not in ("requirements", "pip"):
            out[name] = ver
    return out


def _read_pyproject_versions(text: str) -> dict[str, str]:
    """Read PEP 621 [project] dependencies, the [tool.poetry] block, and the
    [tool.uv] block — best-effort, no tomllib so we don't need Python 3.11+."""
    out: dict[str, str] = {}
    # PEP 621 dependencies = array of strings like "requests>=2.0"
    m = re.search(r"\[project\][^\[]*?dependencies\s*=\s*\[(.*?)\]", text, re.DOTALL)
    if m:
        body = m.group(1)
        for raw in re.findall(r'"([^"]+)"', body):
            mm = re.match(r"^([A-Za-z0-9_.\-]+)\s*([~=!<>]+\s*[\w.\-+\*]+)?", raw.strip())
            if mm:
                v = (mm.group(2) or "").lstrip("~=!<> ").strip()
                out[mm.group(1).lower()] = v
    # Poetry block: dependencies = { foo = "^1.2.3" }
    m = re.search(r"\[tool\.poetry\][^\[]*?dependencies\s*=\s*\{(.*?)\n\}", text, re.DOTALL)
    if m:
        body = m.group(1)
        for line in body.splitlines():
            mm = re.match(r'^\s*([A-Za-z0-9_.\-]+)\s*=\s*"([^"]+)"', line)
            if mm:
                out[mm.group(1).lower()] = mm.group(2).lstrip("^~").strip()
    return out


def _classify_shebang(text: str) -> str | None:
    if text.startswith("#!"):
        first = text.splitlines()[0]
        if "python" in first: return "Python"
        if "node" in first or "deno" in first: return "JavaScript"
        if "ruby" in first: return "Ruby"
        if "bash" in first or "sh" in first: return "Shell"
    return None


# ── Public entry point ────────────────────────────────────────────────────────

def analyze_repo_static(source: str) -> dict[str, Any]:
    """Return detailed analysis of a local file path.

    `source` may be:
      - a directory (cloned repo or extracted workspace)
      - a .zip path
    The function never raises for ordinary noise (missing dep file, etc.) —
    it returns a partial analysis with the keys it managed to fill.
    """
    root = Path(source)
    if root.is_file() and root.suffix.lower() == ".zip":
        root = Path(_extract_zip_to_temp(root))
    elif not root.is_dir():
        return {"error": f"Path not found: {source}"}

    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fname in filenames:
            p = Path(dirpath) / fname
            try:
                rel = p.relative_to(root).as_posix()
            except ValueError:
                continue
            files.append(p)

    total_files = len(files)
    lang_counts: dict[str, int] = {}
    loc_by_lang: dict[str, int] = {}
    file_loc: list[tuple[Path, int]] = []
    src_files: list[Path] = []
    config_files: list[Path] = []
    doc_files: list[Path] = []
    test_files: list[Path] = []
    entry_points: list[str] = []
    env_var_hints: list[str] = []
    frameworks: dict[str, dict[str, Any]] = {}  # display -> {category, version?}
    package_manager: str | None = None
    has_dockerfile = False
    has_compose = False
    docker_db_services: set[str] = set()
    has_ci = False
    ci_systems: set[str] = set()
    version_map_pkg: dict[str, str] = {}
    version_map_req: dict[str, str] = {}

    # Sort deterministically: paths used as anchors first
    def priority(p: Path) -> tuple[int, str]:
        rel = p.relative_to(root).as_posix()
        if rel == "package.json": return (0, rel)
        if rel == "requirements.txt": return (1, rel)
        if rel == "pyproject.toml": return (2, rel)
        if rel == "Dockerfile": return (3, rel)
        if rel.startswith(".github/workflows"): return (4, rel)
        if rel.startswith("docker-compose"): return (5, rel)
        return (9, rel)

    files.sort(key=priority)

    total_loc = 0
    for p in files:
        rel = p.relative_to(root).as_posix()
        ext = p.suffix.lower()
        name = p.name
        # Language / category
        if ext in TEXT_LIKE and name not in ("package-lock.json", "yarn.lock", "pnpm-lock.yaml",
                                              "Cargo.lock", "go.sum", "Gemfile.lock", "composer.lock",
                                              "poetry.lock", "uv.lock", "Pipfile.lock",
                                              "node_modules", ".gitignore"):
            category_lang = LANG_EXT.get(ext)
            source_kind = "markup" if category_lang in ("HTML", "Vue SFC", "Svelte") else "data" \
                if ext in (".json", ".yaml", ".yml", ".toml", ".xml", ".ini") \
                else "doc" if ext == ".md" \
                else "source"
            if source_kind == "source":
                src_files.append(p)
                try:
                    _big = p.stat().st_size > 4_000_000
                except Exception:
                    _big = True
                lc = 0 if _big else _line_count(p)
                if category_lang:
                    lang_counts[category_lang] = lang_counts.get(category_lang, 0) + 1
                    loc_by_lang[category_lang] = loc_by_lang.get(category_lang, 0) + lc
                    file_loc.append((p, lc))
                    total_loc += lc
            elif source_kind in ("data", "markup"):
                config_files.append(p)
            elif source_kind == "doc":
                doc_files.append(p)

        # Manifests / detection
        if name == "package.json" and not version_map_pkg:
            pkg = _read_json(p)
            if isinstance(pkg, dict):
                vmap = _extract_versions_from_pkg(pkg)
                version_map_pkg.update(vmap)
                # Entry points
                main = pkg.get("main")
                if isinstance(main, str): entry_points.append(main)
                scripts = pkg.get("scripts") or {}
                if isinstance(scripts, dict):
                    if "dev" in scripts:
                        ep = scripts["dev"]
                        if isinstance(ep, str): entry_points.append(f"scripts.dev → {ep}")
                    if "start" in scripts:
                        ep = scripts["start"]
                        if isinstance(ep, str): entry_points.append(f"scripts.start → {ep}")

        if name == "requirements.txt" and not version_map_req:
            txt = _read_text(p) or ""
            version_map_req.update(_read_requirements_versions(txt))

        if name == "pyproject.toml" and not version_map_req:
            txt = _read_text(p) or ""
            version_map_req.update(_read_pyproject_versions(txt))

        for lock, pm in PACKAGE_MANAGERS:
            if name == Path(lock).name and package_manager in (None, "npm"):
                # later items in list have lower priority — only set if not set
                if package_manager != pm and pm != "npm":
                    package_manager = pm
            # file just has that name
        if name == "pnpm-lock.yaml" or rel == "pnpm-lock.yaml":
            package_manager = "pnpm"
        elif name == "yarn.lock" or rel == "yarn.lock":
            package_manager = "Yarn"
        elif name == "package-lock.json" and package_manager is None:
            package_manager = "npm"
        elif name == "Pipfile.lock" and package_manager is None:
            package_manager = "Pipenv"
        elif name == "poetry.lock" and package_manager is None:
            package_manager = "Poetry"
        elif name == "uv.lock" and package_manager is None:
            package_manager = "uv"
        elif name == "Cargo.lock" and package_manager is None:
            package_manager = "Cargo"
        elif name == "go.sum" and package_manager is None:
            package_manager = "Go modules"
        elif name == "composer.lock" and package_manager is None:
            package_manager = "Composer"
        elif name == "Gemfile.lock" and package_manager is None:
            package_manager = "Bundler"

        if name == "Dockerfile" or name.startswith("Dockerfile.") or name.endswith(".dockerfile"):
            has_dockerfile = True
        if name.startswith("docker-compose") or rel.startswith(("compose.yaml", "compose.yml")):
            has_compose = True
            txt = _read_text(p) or ""
            for svc_block in re.findall(r"^\s{0,8}(\w[\w-]*):\s*$", txt, re.MULTILINE):
                pass
            for db in DOCKER_HINTS:
                if re.search(rf"image:\s*.*{db}", txt, re.IGNORECASE):
                    docker_db_services.add(db)

        if rel.startswith(".github/workflows/"):
            has_ci = True
            ci_systems.add("GitHub Actions")
        elif name == ".gitlab-ci.yml":
            has_ci = True; ci_systems.add("GitLab CI")
        elif name in (".circleci/config.yml",):
            has_ci = True; ci_systems.add("CircleCI")
        elif name in (".travis.yml",):
            has_ci = True; ci_systems.add("Travis CI")
        elif name == "azure-pipelines.yml":
            has_ci = True; ci_systems.add("Azure Pipelines")

        if re.search(r"__tests__", rel) or rel.endswith((".test.", ".spec.")) or rel.startswith("tests/") or rel.startswith("test/"):
            test_files.append(p)

        # env vars from .env files
        if name.startswith(".env") and name != ".env.example":
            txt = _read_text(p, limit=4000)
            if txt:
                for line in txt.splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"): continue
                    if "=" in line:
                        k = line.split("=", 1)[0].strip()
                        if re.match(r"^[A-Z][A-Z0-9_]+$", k):
                            env_var_hints.append(k)
        elif name in ("Dockerfile",) or name.startswith("docker-compose") or rel.startswith(".github/workflows/"):
            txt = _read_text(p, limit=8000)
            if txt:
                for m in re.finditer(r"^\s*([A-Z][A-Z0-9_]+)\s*=", txt, re.MULTILINE):
                    env_var_hints.append(m.group(1))

        if name == "main.py" and ext == ".py":
            entry_points.append("main.py (Python entry)")
        if name in ("app.py", "wsgi.py", "asgi.py") and ext == ".py":
            entry_points.append(f"{name} (Python entry)")
        if name in ("main.go", "main.rs", "main.java"):
            entry_points.append(f"{name}")
        if name in ("main.tsx", "main.ts", "index.tsx", "index.ts", "App.tsx", "App.jsx"):
            entry_points.append(f"{name} (frontend root)")

        # Shebang language hint - never crashes
        if ext in (".sh", ".bash", ".py"):
            try:
                with p.open("r", encoding="utf-8", errors="ignore") as f:
                    head = f.read(120)
                if _classify_shebang(head):
                    pass
            except Exception:
                pass

    # Combine version maps; prefer requirements / package.json depending on what is present
    merged_versions = dict(version_map_req)
    merged_versions.update(version_map_pkg)

    # Build frameworks / build_tools / tests / linters / db / cloud aggregates
    by_category: dict[str, list[dict[str, Any]]] = {
        "framework": [], "build": [], "test": [], "lint": [], "db": [], "cloud": [],
    }
    for dep_name, version in merged_versions.items():
        lower = dep_name.lower()
        for sig, (display, category) in FRAMEWORK_SIGNATURES.items():
            if lower == sig or lower == sig.lstrip("@"):
                entry = {"name": display, "version": version}
                by_category[category].append(entry)
                break

    # Dedupe by display name keeping highest version
    def dedupe(lst: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen: dict[str, dict[str, Any]] = {}
        for entry in lst:
            key = entry["name"]
            cur = seen.get(key)
            if cur is None or (entry.get("version") and not cur.get("version")):
                seen[key] = entry
        return sorted(seen.values(), key=lambda x: x["name"].lower())

    for cat in by_category:
        by_category[cat] = dedupe(by_category[cat])

    # Top language = by loc
    top_languages = sorted(loc_by_lang.items(), key=lambda kv: (-kv[1], kv[0]))
    primary_language = top_languages[0][0] if top_languages else None
    primary_framework = by_category["framework"][0]["name"] if by_category["framework"] else None

    # Docker hint: if Postgres / Redis / etc. are in compose, mark has_database=True
    has_database_hint = bool(docker_db_services) or any(
        e["name"].endswith("(Postgres)") or e["name"].endswith("(MySQL)") or e["name"].endswith("(MongoDB)")
        for e in by_category["db"]
    )

    return {
        "summary": {
            "total_files": total_files,
            "source_files": len(src_files),
            "config_files": len(config_files),
            "doc_files": len(doc_files),
            "test_files": len(test_files),
            "total_loc": total_loc,
            "primary_language": primary_language,
            "primary_framework": primary_framework,
            "package_manager": package_manager or "not detected",
        },
        "languages": [
            {"name": lang, "files": lang_counts[lang], "loc": loc_by_lang[lang]}
            for lang, _ in top_languages
        ],
        "frameworks": by_category["framework"],
        "build_tools": by_category["build"],
        "tests": by_category["test"],
        "linters_formatters": by_category["lint"],
        "databases_orms": by_category["db"],
        "cloud_sdks": by_category["cloud"],
        "containerization": {
            "has_dockerfile": has_dockerfile,
            "has_docker_compose": has_compose,
            "docker_services": sorted(docker_db_services),
            "databases_detected_from_compose": sorted(docker_db_services),
        },
        "ci_cd": {
            "present": has_ci,
            "systems": sorted(ci_systems),
        },
        "entry_points": sorted(set(entry_points))[:20],
        "environment_variables_hint": sorted(set(env_var_hints))[:50],
        "has_database_hint": has_database_hint,
        "has_dockerfile": has_dockerfile,
    }


def _extract_zip_to_temp(zf_path: Path) -> str:
    """Extract a zip to a temp directory and return that path (caller cleans up)."""
    tmp = tempfile.mkdtemp(prefix="infragenie_static_")
    with zipfile.ZipFile(zf_path) as zf:
        for member in zf.namelist():
            tgt = Path(tmp) / member
            # Zip-Slip protection
            try:
                tgt.resolve().relative_to(Path(tmp).resolve())
            except ValueError:
                continue
            if member.endswith("/"):
                tgt.mkdir(parents=True, exist_ok=True)
                continue
            tgt.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(member) as src, open(tgt, "wb") as dst:
                shutil.copyfileobj(src, dst)
    return tmp


# Convenience: clean up after caller if they used the zip branch
def cleanup_temp(path: str) -> None:
    if path and Path(path).name.startswith("infragenie_static_"):
        shutil.rmtree(path, ignore_errors=True)