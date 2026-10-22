"""Paired seed comparisons; incomplete runs stay visible and are never silently dropped."""
import argparse
import csv
import json
import random
from collections import defaultdict
from pathlib import Path


def analyze(path):
    rows = list(csv.DictReader(Path(path).open()))
    groups = defaultdict(dict)
    for row in rows:
        groups[(row["scenario"], row["policy"])][row["scenario_seed"]] = row
    output = []
    for (scenario, policy), values in sorted(groups.items()):
        base = groups.get((scenario, "fifo"), {})
        paired = sorted(set(values) & set(base), key=int)
        complete = [seed for seed in paired if all(
            int(r["open_orders"]) == 0 and int(r["not_yet_arrived_orders"]) == 0
            for r in (values[seed], base[seed]))]
        deltas = [float(values[seed]["mean_completion_s"])-float(base[seed]["mean_completion_s"]) for seed in complete]
        ci = None
        if len(deltas) >= 2:
            rng = random.Random(1729)
            estimates = sorted(sum(rng.choices(deltas, k=len(deltas)))/len(deltas) for _ in range(2000))
            ci = [estimates[49], estimates[1949]]
        output.append(dict(scenario=scenario, policy=policy, external_seeds=len(values),
            paired_seeds=len(paired), fully_completed_pairs=len(complete),
            incomplete_pairs=len(paired)-len(complete),
            open_orders=sum(int(r["open_orders"]) for r in values.values()),
            mean_paired_delta_s=sum(deltas)/len(deltas) if deltas else None,
            bootstrap95_delta_s=ci,
            warning="Completion delta conditional on complete pairs; inspect unfinished orders before ranking."))
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("summary")
    print(json.dumps(analyze(parser.parse_args().summary), indent=2))

