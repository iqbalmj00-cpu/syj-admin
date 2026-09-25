#!/usr/bin/env python3
"""Rebuild the dashboard's local structural map, or check it without writes.

Run with the interpreter recorded in .graphify_python. No application modules are
imported or executed. Graphify's local AST APIs are used without LLM/provider APIs.
All generated files and fresh extraction caches stay inside graphify-out/.
"""
from __future__ import annotations

import argparse
import atexit
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
import hashlib
import html
from importlib.metadata import version, PackageNotFoundError
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
OUT = Path(__file__).resolve().parent
ROOT = OUT.parent
# Set before importing Graphify: no environment-controlled output escape or
# optional Google Workspace export, and no project source imported by this script.
os.environ["GRAPHIFY_OUT"] = "graphify-out"
os.environ["GRAPHIFY_GOOGLE_WORKSPACE"] = "0"

SCHEMA = 1
PRUNE = {
    ".git", "node_modules", "venv", ".venv", "gateway_venv", "__pycache__",
    ".next", ".vercel", ".cache", ".pytest_cache", ".mypy_cache", ".ruff_cache",
    "dist", "build", "coverage", "out", "site-packages", "graphify-out",
    "simplemaps_uszips_basicv1", ".worktrees", "worktrees",
}
TEXT_DOCS = {".md", ".mdx", ".rst", ".txt"}
SOURCE_EXT = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sql", ".json",
    ".toml", ".yaml", ".yml", ".sh", ".bash", ".html", ".css", ".scss",
    ".sass", ".prisma", ".graphql", ".gql", ".xml", ".ini", ".cfg",
}
# Verified dispatch for the languages/config present in this project. New
# formats remain inventoried as unsupported rather than silently disappearing.
AST_EXT = {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sql", ".json", ".sh", ".bash"}
AST_MANIFESTS = {"pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "apm.yml", "apm.yaml"}
ARTIFACTS = [
    "graph.json", "graph.html", "GRAPH_REPORT.md", "ast-raw.json", "manifest.json",
    "evidence-classification.json", "excluded-docs.json", "coverage.json", "cost.json",
    ".graphify_labels.json", ".graphify_labels.json.sig", ".graphify_analysis.json",
    ".graphify_root", ".graphify_python",
]
LIMITS = [
    "SOURCE_VERIFIED structural extraction only; no application tests, runtime, database, provider, deployment, or production verification is implied.",
    "Only this dashboard root is scanned. /Volumes/CODE/ENRICHMENT AGENT and all other sibling repositories are outside this graph.",
    "An extracted edge is parser evidence, not proof that a path runs. INFERRED edges remain explicitly labeled and are excluded from the strict reachability calculation.",
    "Dynamic dispatch, string-based SQL, HTTP calls, environment wiring, and unsupported formats can hide real connections. No static path does not prove dead code.",
    "Documents are inventoried, not parsed into graph assertions or certified by this build. Generated output, secrets, dependencies, and runtime data are excluded from AST extraction.",
    "Graphify uses a directed simple graph: parallel relationships with the same endpoints can collapse. ast-raw.json preserves the extracted relationships before this projection.",
    "HTML generation is local; the interactive viewer loads vis-network 9.1.6 from unpkg.com when opened.",
    "Use refresh.py for updates. Generic graphify update/extract uses a different corpus policy and does not maintain this inventory, evidence classification, or provenance.",
]


def digest(path: Path, algorithm: str = "sha256") -> str:
    h = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def dump(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def cache_hashes(base: Path) -> dict:
    return {p.relative_to(base).as_posix(): digest(p) for p in sorted(base.rglob("*")) if p.is_file()}


def sensitive(path: Path) -> bool:
    """Conservative filename-only guard; no credential file is opened."""
    rel = path.relative_to(ROOT)
    name = path.name.lower()
    if any(p.lower() in {".aws", ".ssh", ".gnupg", ".azure", "secrets", ".secrets", "credentials"} for p in rel.parts[:-1]):
        return True
    if name.startswith((".env", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519")) or path.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".cert", ".crt", ".der", ".p8"}:
        return True
    if name in {".npmrc", ".pypirc", ".netrc", ".pgpass", ".htpasswd", ".git-credentials", ".boto"}:
        return True
    genuine_source = path.suffix.lower() in AST_EXT - {".json"}
    if not genuine_source and re.search(r"(^|[._-])(credentials?|secrets?|passwords?|private_key|tokens?|service_account)([._-]|$)", name):
        return True
    return False


def inventory() -> dict:
    """Every non-pruned path gets a category; secrets are never opened or hashed."""
    files, excluded_dirs = {}, []
    for parent, dirs, names in os.walk(ROOT, followlinks=False):
        base = Path(parent)
        kept = []
        for name in sorted(dirs):
            path = base / name
            if path.is_symlink() or name in PRUNE or name.startswith(".next.stale-") or (path / ".git").exists():
                excluded_dirs.append(path.relative_to(ROOT).as_posix() + "/")
            else:
                kept.append(name)
        dirs[:] = kept
        for name in sorted(names):
            path = base / name
            rel = path.relative_to(ROOT).as_posix()
            if path.is_symlink():
                files[rel] = {"category": "symlink-not-followed"}
                continue
            if not path.is_file():
                continue
            if sensitive(path):
                files[rel] = {"category": "sensitive-not-read"}
                continue
            if name == ".DS_Store" or name.endswith((".tsbuildinfo", ".pyc", ".log", ".db", ".db-wal", ".db-shm")):
                files[rel] = {"category": "runtime-generated-not-read"}
                continue
            historical = rel.startswith(("reports/", "output/", "outputs/"))
            if path.suffix.lower() in TEXT_DOCS and name != "requirements.txt":
                category = "historical-document" if historical else "document"
            elif historical:
                category = "historical-output"
            elif rel.startswith((".claude/", ".agents/")):
                # Assistant settings may contain connection details; inventory only.
                files[rel] = {"category": "assistant-configuration-not-read"}
                continue
            elif ("/fixtures/" in rel and path.suffix.lower() in {".json", ".csv"}):
                category = "test-fixture-data"
            elif name in {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "next-env.d.ts"}:
                category = "generated-contract"
            elif path.suffix.lower() in SOURCE_EXT or name in {"Dockerfile", "Makefile", "requirements.txt", ".gitignore"}:
                category = "ast-source" if path.suffix.lower() in AST_EXT or name in AST_MANIFESTS else "source-without-ast"
            else:
                category = "asset-or-other"
            files[rel] = {
                "category": category, "bytes": path.stat().st_size,
                "sha256": digest(path),
            }
    return {"files": dict(sorted(files.items())), "excluded_directories": sorted(excluded_dirs)}


def source_paths(inv: dict) -> list[str]:
    return [p for p, item in inv["files"].items() if item["category"] == "ast-source"]


def head() -> str | None:
    result = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def classify_entries(paths: list[str]) -> tuple[dict, dict]:
    # vercel.json is local configuration evidence, not provider schedule evidence.
    config = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    scheduled = {v["path"]: v["schedule"] for v in config.get("crons", [])}
    entries = {}
    for path in paths:
        if "/__tests__/" in path or "/tests/" in path or Path(path).name.startswith("test-") or path == "tsconfig.test.json":
            category = "test"
        elif path.startswith("src/app/api/") and path.endswith("/route.ts"):
            route = path[len("src/app"): -len("/route.ts")]
            if route in scheduled:
                category = "cron-configured"
            elif path.startswith("src/app/api/cron/"):
                category = "cron-not-configured"
            else:
                category = "api-route"
        elif path.startswith("src/app/") and Path(path).name in {"page.tsx", "layout.tsx", "error.tsx", "not-found.tsx", "loading.tsx"}:
            category = "ui-entry"
        elif path == "src/middleware.ts":
            category = "middleware"
        elif path == "Lead Scraper Agent/worker/server.py":
            category = "worker-entry"
        elif path == "gateway.py":
            category = "local-gateway"
        elif path.startswith("scripts/"):
            category = "ops-script"
        elif "/" not in path and ("config" in path or path in {"package.json", "vercel.json"}):
            category = "build-config"
        else:
            continue
        entries[path] = category
    return entries, scheduled


def evidence(raw: dict, paths: list[str], stamp: str) -> dict:
    """Conservative file dependency projection, not a runtime/dead-code claim."""
    sources = set(paths)
    node_files = {n["id"]: n.get("source_file") for n in raw["nodes"]}
    adjacency = defaultdict(set)
    relations = {"imports", "imports_from", "re_exports", "dynamic_import", "calls", "uses", "inherits", "extends"}
    for edge in raw["edges"]:
        if edge.get("confidence", "EXTRACTED") != "EXTRACTED" or edge.get("relation") not in relations:
            continue
        source = edge.get("source_file") or node_files.get(edge.get("source"))
        target = node_files.get(edge.get("target"))
        if source in sources and target in sources and source != target:
            adjacency[source].add(target)
    entries, scheduled = classify_entries(paths)
    reach = {}
    for category in sorted(set(entries.values())):
        seen = {p for p, value in entries.items() if value == category}
        queue = deque(sorted(seen))
        while queue:
            for target in sorted(adjacency[queue.popleft()] - seen):
                seen.add(target)
                queue.append(target)
        reach[category] = sorted(seen)
    covered = set().union(*(set(v) for v in reach.values())) if reach else set()
    product = set().union(*(set(reach.get(v, [])) for v in ("api-route", "ui-entry", "cron-configured", "middleware", "worker-entry")))
    return {
        "schema_version": SCHEMA, "generated_at": stamp, "evidence_state": "SOURCE_VERIFIED",
        "method": "Directed file-level BFS over EXTRACTED import/call/inheritance edges; entry files included; external pseudo-files excluded; INFERRED edges omitted.",
        "limitations": "Structural reachability is not execution or production proof; no path does not mean dead code. Tests have not been executed by this generator.",
        "file_count": len(sources), "entry_counts": dict(sorted(Counter(entries.values()).items())),
        "entries": entries, "reach_counts": {k: len(v) for k, v in reach.items()},
        "reach_sets": reach, "product_entry_reachable_count": len(product),
        "product_entry_reachable": sorted(product),
        "no_static_entry_path": sorted(sources - covered),
        "configured_crons": scheduled,
    }


def validate_graph(graph: dict, raw: dict, paths: list[str]) -> list[str]:
    errors = []
    ids = [n["id"] for n in graph["nodes"]]
    id_set = set(ids)
    if len(ids) != len(id_set):
        errors.append("Duplicate graph node ids")
    for edge in graph.get("links", graph.get("edges", [])):
        if edge["source"] not in id_set or edge["target"] not in id_set:
            errors.append("Dangling graph edge")
            break
    source_set = set(paths)
    represented = {n.get("source_file") for n in graph["nodes"]}
    if source_set - represented:
        errors.append("Unrepresented AST files: " + ", ".join(sorted(source_set - represented)))
    # Pseudo-files for builtins/external imports are valid nodes, never physical
    # source coverage. Local file locations must reference current source lines.
    line_counts = {}
    for p in paths:
        line_counts[p] = len((ROOT / p).read_text(encoding="utf-8", errors="replace").splitlines())
    for item in raw["nodes"] + raw["edges"]:
        path = item.get("source_file")
        if path not in source_set:
            continue
        match = re.match(r"^L(\d+)", str(item.get("source_location", "")))
        if match and int(match.group(1)) > max(1, line_counts[path]):
            errors.append(f"Source line exceeds current file: {path}:{match.group(1)}")
    return sorted(set(errors))


def check() -> int:
    try:
        provenance = json.loads((OUT / "provenance.json").read_text())
        saved = json.loads((OUT / "coverage.json").read_text())
    except (OSError, ValueError) as exc:
        print(f"STALE: no valid refresh provenance: {exc}")
        return 1
    errors = []
    current = inventory()
    old = saved["inventory"]
    old_files, new_files = old["files"], current["files"]
    for label, paths in (("added", set(new_files) - set(old_files)), ("removed", set(old_files) - set(new_files)), ("changed", {p for p in set(old_files) & set(new_files) if old_files[p] != new_files[p]})):
        if paths:
            errors.append(f"{label}: " + ", ".join(sorted(paths)))
    if old["excluded_directories"] != current["excluded_directories"]:
        errors.append("Excluded directory inventory changed")
    if provenance.get("generator_sha256") != digest(Path(__file__)):
        errors.append("Refresh generator changed")
    try:
        if provenance.get("graphify_version") != version("graphifyy"):
            errors.append("Graphify version changed")
    except PackageNotFoundError:
        pass  # --check is intentionally stdlib-only under system Python.
    for name, expected in provenance.get("artifact_sha256", {}).items():
        if not (OUT / name).is_file() or digest(OUT / name) != expected:
            errors.append(f"Artifact changed or missing: {name}")
    if cache_hashes(OUT / "cache") != provenance.get("cache_sha256", {}):
        errors.append("Extraction cache changed or missing; rebuild to restore one consistent generation")
    # A documentation-only commit advances HEAD without changing the mapped
    # contents. The recorded commit is build context; hashes above decide drift.
    try:
        graph = json.loads((OUT / "graph.json").read_text())
        raw = json.loads((OUT / "ast-raw.json").read_text())
        errors.extend(validate_graph(graph, raw, source_paths(current)))
        manifest = json.loads((OUT / "manifest.json").read_text())
        paths = source_paths(current)
        if set(manifest) != set(paths):
            errors.append("Manifest source set does not match inventory")
        for path in set(manifest) & set(paths):
            if manifest[path]["ast_hash"] != digest(ROOT / path, "md5"):
                errors.append(f"Manifest hash mismatch: {path}")
        classification = json.loads((OUT / "evidence-classification.json").read_text())
        if classification != evidence(raw, paths, provenance["generated_at"]):
            errors.append("Evidence classification differs from current extraction")
        if len(graph["nodes"]) != provenance["nodes"] or len(graph.get("links", graph.get("edges", []))) != provenance["edges"]:
            errors.append("Graph counts differ from provenance")
    except (OSError, ValueError, KeyError) as exc:
        errors.append(f"Invalid artifact: {exc}")
    if errors:
        print("STALE / INVALID\n" + "\n".join(f"- {v}" for v in errors))
        return 1
    print(f"CURRENT: {len(source_paths(current))} AST files; {provenance['nodes']} nodes; {provenance['edges']} edges. Source/document inventory and generated artifacts match their recorded hashes.")
    return 0


def rebuild() -> int:
    try:
        version("graphifyy")
    except PackageNotFoundError:
        interpreter = Path((OUT / ".graphify_python").read_text().strip())
        if not interpreter.is_file() or interpreter == Path(sys.executable):
            raise RuntimeError("Recorded Graphify interpreter is unavailable; no dependency installation was attempted")
        os.execv(str(interpreter), [str(interpreter), "-B", str(Path(__file__))])
    from graphify.extract import extract
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all, label_communities_by_hub, community_member_sigs
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.export import to_json, to_html
    from graphify.report import generate
    from graphify import cache as graphify_cache

    inv = inventory()
    paths = source_paths(inv)
    stamp = datetime.now(timezone.utc).isoformat()
    commit = head()
    # Never reuse historical cache entries or graph annotations. Every file is
    # parsed into a fresh cache; staging is removed only after our own run ends.
    with tempfile.TemporaryDirectory(prefix=".refresh-", dir=OUT) as temporary:
        stage_root = Path(temporary)
        stage = stage_root / "graphify-out"
        stage.mkdir()
        print(f"Extracting {len(paths)} first-party source/config files locally...", flush=True)
        try:
            raw = extract([ROOT / p for p in paths], root=ROOT, cache_root=stage_root, parallel=False)
        finally:
            # Graphify normally flushes this cache at process exit. Flush while
            # staging still exists, include it in provenance, and unregister the
            # callback so it cannot recreate a deleted staging directory later.
            graphify_cache._flush_stat_index()
            atexit.unregister(graphify_cache._flush_stat_index)
        if raw.get("failed_sources"):
            raise RuntimeError("AST extraction failed: " + ", ".join(raw["failed_sources"]))
        dump(stage / "ast-raw.json", raw)
        graph = build_from_json(raw, directed=True, root=ROOT)
        communities = cluster(graph)
        labels = label_communities_by_hub(graph, communities)
        graph.graph.update({
            "generated_at": stamp, "evidence_state": "SOURCE_VERIFIED", "scan_root": str(ROOT),
            "generator": "graphify-out/refresh.py", "graphify_version": version("graphifyy"),
            "limitations": LIMITS,
            "historical_enrichment_note": "The 2026-09-25 manual amendment recorded a latest-10-review worker change in the separate ENRICHMENT AGENT repository. It is a historical observation, not recertified by this dashboard rebuild. See WORKING_KNOWLEDGE.md for its current status and external-source limits.",
        })
        to_json(graph, communities, str(stage / "graph.json"), force=True, built_at_commit=commit, community_labels=labels)
        written = json.loads((stage / "graph.json").read_text())
        errors = validate_graph(written, raw, paths)
        if errors:
            raise RuntimeError("\n".join(errors))
        scores = score_all(graph, communities)
        gods = god_nodes(graph)
        surprises = surprising_connections(graph, communities)
        questions = suggest_questions(graph, communities, labels)
        manifest = {p: {"mtime": (ROOT / p).stat().st_mtime, "ast_hash": digest(ROOT / p, "md5"), "semantic_hash": ""} for p in paths}
        dump(stage / "manifest.json", manifest)
        classification = evidence(raw, paths, stamp)
        dump(stage / "evidence-classification.json", classification)
        documents = {p: info for p, info in inv["files"].items() if info["category"] in {"document", "historical-document"}}
        dump(stage / "excluded-docs.json", {
            "schema_version": SCHEMA, "generated_at": stamp,
            "reason": "All prose is excluded from structural extraction. Inventory/hashes establish freshness tracking, not factual verification or active authority.",
            "documents": documents,
        })
        counts = dict(sorted(Counter(v["category"] for v in inv["files"].values()).items()))
        pseudo = sorted({n.get("source_file") for n in written["nodes"] if n.get("source_file") and n["source_file"] not in paths})
        coverage = {
            "schema_version": SCHEMA, "generated_at": stamp, "root": str(ROOT),
            "scope": "Current working tree, including uncommitted source and the ignored first-party gateway.py; no sibling repository traversal.",
            "category_counts": counts, "inventory": inv,
            "ast_files": paths,
            "unsupported_source_files": [p for p, info in inv["files"].items() if info["category"] == "source-without-ast"],
            "external_pseudo_sources": pseudo,
            "limitations": LIMITS,
        }
        dump(stage / "coverage.json", coverage)
        dump(stage / ".graphify_labels.json", {str(k): v for k, v in labels.items()})
        dump(stage / ".graphify_labels.json.sig", {str(k): v for k, v in community_member_sigs(communities).items()})
        dump(stage / ".graphify_analysis.json", {
            "generated_at": stamp, "communities": {str(k): v for k, v in communities.items()},
            "cohesion": {str(k): v for k, v in scores.items()}, "gods": gods,
            "surprises": surprises, "questions": questions,
        })
        previous_cost = json.loads((OUT / "cost.json").read_text()) if (OUT / "cost.json").exists() else {}
        runs = [dict(run, historical=True) for run in previous_cost.get("runs", [])]
        runs.append({"date": stamp, "mode": "local-ast-only", "input_tokens": 0, "output_tokens": 0, "files": len(paths), "historical": False})
        dump(stage / "cost.json", {"runs": runs, "total_input_tokens": sum(v.get("input_tokens", 0) for v in runs), "total_output_tokens": sum(v.get("output_tokens", 0) for v in runs), "note": "Prior runs are historical cost observations, not current graph evidence. This refresh makes no paid API calls."})
        words = sum(len((ROOT / p).read_text(encoding="utf-8", errors="replace").split()) for p in paths)
        report = generate(graph, communities, scores, labels, gods, surprises,
                          {"total_files": len(paths), "total_words": words},
                          {"input": 0, "output": 0}, str(ROOT),
                          suggested_questions=questions, built_at_commit=None)
        first, rest = report.split("\n", 1)
        overview = [first, "", "## Build scope and freshness", "", f"Generated **{stamp}** from the current working tree with Graphify **{version('graphifyy')}**.",
                    "", f"**{len(paths)} physical AST source/config files · {graph.number_of_nodes()} nodes · {graph.number_of_edges()} directed graph edges · {len(communities)} communities.**",
                    "", f"The raw extraction contains {len(raw['nodes'])} nodes and {len(raw['edges'])} edges. The graph projection may merge repeated relationships.",
                    "", "Refresh: `python3 graphify-out/refresh.py`", "",
                    "Check without writes: `python3 graphify-out/refresh.py --check`", "",
                    f"Git HEAD context: `{commit}`. `coverage.json` records the complete bounded file inventory and hashes; `provenance.json` records source/artifact provenance. The Git commit is context only: working-tree hashes are the freshness authority.", "",
                    "## Evidence limits", ""]
        overview += ["- " + limit for limit in LIMITS]
        overview += ["", "## Coverage categories", "", "| Category | Files |", "|---|---:|"]
        overview += [f"| {category} | {count} |" for category, count in counts.items()]
        overview += ["", "Unsupported source formats are tracked by content hash:", ""]
        overview += [f"- `{p}`" for p in coverage["unsupported_source_files"]]
        overview += ["", "## Entrypoints and structural reachability", "", "These are static paths, not runtime or deployment states. Configured crons come from local `vercel.json`.", "", "| Entry category | Entry files | Reachable physical files |", "|---|---:|---:|"]
        overview += [f"| {category} | {count} | {classification['reach_counts'][category]} |" for category, count in classification["entry_counts"].items()]
        overview += ["", f"{len(classification['no_static_entry_path'])} source/config files have no strict static path from these entry categories; see `evidence-classification.json`. This does not establish that they are dead.",
                    "", "## Historical enrichment amendment", "", graph.graph["historical_enrichment_note"], "", "---", "", rest]
        (stage / "GRAPH_REPORT.md").write_text("\n".join(overview), encoding="utf-8")
        to_html(graph, communities, str(stage / "graph.html"), community_labels=labels, node_limit=max(5000, graph.number_of_nodes()))
        viewer = (stage / "graph.html").read_text(encoding="utf-8")
        banner = f'<div style="position:fixed;top:0;left:0;right:280px;z-index:10;padding:8px 12px;background:#242436;color:#ddd;font:12px system-ui">Source map rebuilt {html.escape(stamp[:10])} · {len(paths)} physical files · static evidence only · <a style="color:#8cbeff" href="GRAPH_REPORT.md">scope and limits</a></div>'
        viewer = viewer.replace("<body>", "<body>" + banner, 1)
        (stage / "graph.html").write_text(viewer, encoding="utf-8")
        (stage / ".graphify_root").write_text(str(ROOT) + "\n")
        (stage / ".graphify_python").write_text(sys.executable + "\n")
        # Fail if concurrent edits occurred during the build instead of blessing
        # a graph built from a mixture of revisions.
        if inventory() != inv:
            raise RuntimeError("Source/document inventory changed during generation; rerun after edits settle")
        provenance = {
            "schema_version": SCHEMA, "generated_at": stamp, "root": str(ROOT),
            "head_commit": commit, "graphify_version": version("graphifyy"),
            "generator_sha256": digest(Path(__file__)), "mode": "fresh-local-ast",
            "nodes": graph.number_of_nodes(), "edges": graph.number_of_edges(),
            "communities": len(communities), "ast_files": len(paths),
            "raw_nodes": len(raw["nodes"]), "raw_edges": len(raw["edges"]),
            "artifact_sha256": {name: digest(stage / name) for name in ARTIFACTS},
            "cache_sha256": cache_hashes(stage / "cache"),
        }
        # Each individual replacement is atomic. Provenance is written last;
        # --check detects interruption or any incomplete artifact set.
        for name in ARTIFACTS:
            os.replace(stage / name, OUT / name)
        # The old cache is a generated artifact, not a source input. Keep it
        # inside our temporary area until all replacements finish, then discard
        # it with that area so stale fragments cannot feed another update.
        if (OUT / "cache").exists():
            shutil.move(str(OUT / "cache"), stage_root / "previous-cache")
        if (stage / "cache").exists():
            shutil.move(str(stage / "cache"), OUT / "cache")
        provenance_tmp = OUT / ".provenance-refresh.tmp"
        dump(provenance_tmp, provenance)
        os.replace(provenance_tmp, OUT / "provenance.json")
    return check()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Check inventory, hashes, and artifact consistency without writes")
    args = parser.parse_args()
    try:
        sys.exit(check() if args.check else rebuild())
    except Exception as exc:
        print(f"Refresh failed: {exc}", file=sys.stderr)
        sys.exit(1)
