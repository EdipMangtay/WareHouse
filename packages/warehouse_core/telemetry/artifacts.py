from dataclasses import asdict
from pathlib import Path
import hashlib
import json
import subprocess
import sys


def version_info(root: Path) -> dict:
    def git(*args):
        result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=False)
        return result.stdout.strip() if result.returncode == 0 else "unavailable"
    # Includes uncommitted code so runs from a working tree remain identifiable.
    digest = hashlib.sha256()
    for base in ("packages/warehouse_core", "apps/runner"):
        for path in sorted((root/base).rglob("*.py")):
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
    return dict(commit=git("rev-parse", "HEAD"), dirty=bool(git("status", "--porcelain")),
                core_source_sha256=digest.hexdigest(), python=sys.version, core_version="0.2.0")


def save_run(engine, directory: Path, version: dict):
    directory.mkdir(parents=True, exist_ok=False)
    def write(name, data):
        (directory/name).write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)+"\n")
    config = engine.scenario.manifest()
    config.update(policy=engine.policy, algorithm_seed=engine.algorithm_seed, search_budget=engine.search_budget,
                  time_limit_ms=engine.time_limit_ms, version=version)
    write("run.json", config)
    for name, rows in (("events", engine.telemetry.events), ("decisions", engine.telemetry.decisions),
                       ("samples", engine.telemetry.samples)):
        with (directory/f"{name}.jsonl").open("w") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False, allow_nan=False)+"\n")
    write("orders.json", [asdict(o) | {"flow_time_s": o.completed_s-o.arrival_s if o.completed_s is not None else None}
                          for o in engine.state.orders.values()])
    metrics = engine.telemetry.metrics(engine.state, engine.now)
    metrics["not_yet_arrived_orders"] = len(engine.scenario.orders)-engine.next_order
    write("metrics.json", metrics)
    write("final_snapshot.json", engine.snapshot())
    return metrics

