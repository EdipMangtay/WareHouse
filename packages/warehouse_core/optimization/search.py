from __future__ import annotations
from dataclasses import dataclass
from time import perf_counter

from .representation import Priorities, encode, decode
from .evaluation import CandidateEvaluator


@dataclass
class SearchResult:
    plan: Priorities
    score: float | None
    evaluations: int
    compute_ms: float
    cohort: list[str]
    candidates: list[dict]
    fallback: bool = False


def search(engine, baseline: Priorities) -> SearchResult:
    started = perf_counter()
    evaluator = CandidateEvaluator(engine)
    ids = list(baseline.preparation)
    rng, budget = engine.search_rng, engine.search_budget
    conveyor_only = engine.policy == "gwo_conveyor"
    previous = engine.plan.adapt(ids)
    if conveyor_only:
        previous = Priorities(baseline.preparation, previous.conveyor)
    best_plan, best_score, evaluations = previous, float("inf"), 0
    candidates = []

    def available():
        return evaluations < budget and (evaluations == 0 or engine.time_limit_ms is None or
               (perf_counter()-started)*1000 < engine.time_limit_ms)

    def assess(plan):
        nonlocal best_plan, best_score, evaluations
        result = evaluator.evaluate(plan)
        evaluations += 1
        candidates.append(dict(evaluation=evaluations, score=result.score if result.feasible else None,
                               feasible=result.feasible, open_orders=result.open_orders,
                               preparation=list(plan.preparation), conveyor=list(plan.conveyor)))
        if result.feasible and result.score < best_score:
            best_plan, best_score = plan, result.score
        return result.score

    assess(previous)
    if available():
        assess(baseline)
    if engine.policy == "local_search":
        while available():
            prep, belt = list(best_plan.preparation), list(best_plan.conveyor)
            if len(ids) > 1:
                # Joint search: alternate preparation, belt and simultaneous neighbourhoods.
                for values in ([prep] if evaluations % 3 == 0 else [belt] if evaluations % 3 == 1 else [prep, belt]):
                    a, b = rng.sample(range(len(ids)), 2)
                    values[a], values[b] = values[b], values[a]
            assess(Priorities(tuple(prep), tuple(belt)))
    else:
        dimensions = len(ids) * (1 if conveyor_only else 2)
        population = [(best_score, encode(best_plan, ids, conveyor_only))]
        generation = 0
        while available():
            if len(population) < 4:
                keys = [rng.random() for _ in range(dimensions)]
            else:
                leaders = sorted(population, key=lambda pair: pair[0])[:3]
                current = population[generation % len(population)][1]
                a = 2 * (1 - evaluations / max(1, budget))
                keys = []
                for j in range(dimensions):
                    positions = []
                    for _, leader in leaders:
                        A, C = 2*a*rng.random()-a, 2*rng.random()
                        positions.append(leader[j] - A*abs(C*leader[j]-current[j]))
                    keys.append(min(1.0, max(0.0, sum(positions)/len(positions))))
            plan = decode(keys, ids, baseline.preparation if conveyor_only else None)
            score = assess(plan)
            if len(population) < 4:
                population.append((score, keys))
            else:
                population[generation % len(population)] = (score, keys)
            # Global incumbent is retained separately, even when a wolf worsens.
            generation += 1
    fallback = best_score == float("inf")
    return SearchResult(baseline if fallback else best_plan, None if fallback else best_score,
                        evaluations, (perf_counter()-started)*1000, list(evaluator.order_ids), candidates, fallback)

