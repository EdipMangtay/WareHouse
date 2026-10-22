from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import json
from pathlib import Path

from warehouse_core.policies import POLICIES
from warehouse_core.simulation.engine import Simulation
from warehouse_core.simulation.scenario import load_scenario
from warehouse_core.telemetry.artifacts import save_run, version_info

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description="WareTwin reproducible coordination experiments")
    parser.add_argument("mode", choices=["run", "batch"])
    parser.add_argument("--scenario", default="balanced", help="scenario name, JSON path, or all (batch)")
    parser.add_argument("--policy", choices=[*POLICIES, "all"], default="fifo")
    parser.add_argument("--seed", type=int, default=42, help="first external scenario seed")
    parser.add_argument("--seeds", type=int, default=30, help="external scenario seed count for batch")
    parser.add_argument("--algorithm-seed", type=int, default=7)
    parser.add_argument("--budget", type=int, default=12, help="fixed candidate evaluation budget per decision")
    parser.add_argument("--time-limit-ms", type=float, help="optional soft live budget; not deterministic")
    parser.add_argument("--output", type=Path, default=ROOT/"experiments/results")
    args = parser.parse_args()
    if args.seeds < 1:
        parser.error("--seeds must be positive")
    if args.mode == "run" and (args.policy == "all" or args.scenario == "all"):
        parser.error("use batch for all policies/scenarios")
    files = sorted((ROOT/"experiments/scenarios").glob("*.json")) if args.scenario == "all" else [
        Path(args.scenario) if Path(args.scenario).is_file() else ROOT/"experiments/scenarios"/f"{args.scenario}.json"]
    policies = POLICIES if args.policy == "all" else [args.policy]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    output = args.output/stamp
    output.mkdir(parents=True, exist_ok=False)
    version = version_info(ROOT)
    rows = []
    seeds = range(args.seed, args.seed+(args.seeds if args.mode == "batch" else 1))
    for file in files:
        for seed in seeds:
            scenario = load_scenario(file, seed)
            for policy in policies:
                engine = Simulation(scenario, policy, args.algorithm_seed, args.budget, args.time_limit_ms)
                engine.run()
                path = output/f"{scenario.name}-{seed}-{policy}"
                metrics = save_run(engine, path, version)
                row = dict(scenario=scenario.name, scenario_seed=seed, algorithm_seed=args.algorithm_seed, policy=policy,
                           **{k:v for k,v in metrics.items() if not isinstance(v,(dict,list))})
                rows.append(row)
                print(json.dumps(dict(run=str(path), completed=metrics["completed_orders"],
                    open=metrics["open_orders"], mean_s=metrics["mean_completion_s"])), flush=True)
                # Save after each run, so interrupted batches retain usable results.
                with (output/"summary.csv").open("w", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
                    writer.writeheader(); writer.writerows(rows)
    print(f"Summary: {output/'summary.csv'}")

