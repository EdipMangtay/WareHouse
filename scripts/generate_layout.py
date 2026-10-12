#!/usr/bin/env python3
"""Generate validated canonical presets without changing any active layout."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.layout_generator import PRESETS, generate_layout, preset_config


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preset", choices=[*PRESETS, "all"], default="all")
    for name in ("width", "depth", "corridor", "main-corridor", "rack-width", "rack-depth", "rack-height", "rack-levels", "bays-per-level", "robot-count", "packing-stations", "sorting-stations", "zone-split-x", "zone-split-z", "unloading-capacity", "seed"):
        parser.add_argument(f"--{name}", type=int)
    for name in ('conveyor-speed','parcel-pitch','parcel-gap'):
        parser.add_argument(f'--{name}',type=float)
    args = parser.parse_args()
    overrides = {k: v for k, v in vars(args).items() if k != "preset" and v is not None}
    if args.preset == "all" and overrides:
        parser.error("Choose one --preset when overriding its configuration")
    output = ROOT / "shared" / "layouts"
    layouts = []
    for name in PRESETS if args.preset == "all" else [args.preset]:
        try:
            layouts.append((name, generate_layout(preset_config(name, **overrides))))
        except ValueError as error:
            parser.error(str(error))
    output.mkdir(parents=True, exist_ok=True)
    for name, layout in layouts:
        target = output / f"{name}.json"
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(layout, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(target)
        counts = layout["metadata"]["counts"]
        print(f"{name}: {counts['racks']} racks, {counts['storage_slots']} slots, {counts['robots']} robots → {target}")


if __name__ == "__main__":
    main()
