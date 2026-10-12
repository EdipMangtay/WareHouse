#!/usr/bin/env python3
"""Real HTTP load generator; writes observed results, never invents throughput.

Run separately from the backend to measure network + ASGI + database latency.
Checkout requests reserve actual stock and remain in order history.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from pathlib import Path


def request(url: str, body: dict | None = None):
    began = time.perf_counter()
    payload = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            return res.status, (time.perf_counter() - began) * 1000, json.load(res)
    except urllib.error.HTTPError as exc:
        return exc.code, (time.perf_counter() - began) * 1000, None
    except (OSError, ValueError):
        return 0, (time.perf_counter() - began) * 1000, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--rate", type=int, choices=[5, 100, 500, 1000], default=100)
    parser.add_argument("--seconds", type=int, default=30)
    parser.add_argument("--mode", choices=["read", "checkout"], default="read")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 300:
        parser.error("--seconds must be 1..300")
    base = args.base_url.rstrip("/")
    product = None
    if args.mode == "checkout":
        status, _, catalog = request(base + "/api/commerce/products")
        if status != 200 or not catalog or not catalog["products"]:
            parser.error("Catalog unavailable")
        product = max(catalog["products"], key=lambda p: p["stock"])["id"]
    began = time.perf_counter()
    count = max(1, int(args.rate * args.seconds / 60))
    futures = []
    def run(index):
        if args.mode == "read":
            return request(base + "/api/commerce/products")
        return request(base + "/api/commerce/orders", {
            "customer_name": "HTTP Yük Testi", "email": "load@example.test",
            "address": "Yerel geliştirme yük testi, fiziksel teslimat yok",
            "delivery_method": "standard", "items": [{"product_id": product, "quantity": 1}],
            "idempotency_key": "http-load-" + uuid.uuid4().hex,
        })
    with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
        for index in range(count):
            scheduled = began + index * 60 / args.rate
            time.sleep(max(0, scheduled - time.perf_counter()))
            futures.append(pool.submit(run, index))
        results = [future.result() for future in futures]
    elapsed = time.perf_counter() - began
    latency = sorted(result[1] for result in results)
    statuses = Counter(str(result[0]) for result in results)
    percentile = lambda p: round(latency[min(len(latency) - 1, int((len(latency) - 1) * p))], 2)
    report = {"mode": args.mode, "target_requests_per_minute": args.rate,
        "scheduled_window_seconds": args.seconds, "elapsed_seconds": round(elapsed, 3),
        "requests": len(results), "successful_requests": sum(200 <= r[0] < 300 for r in results),
        "status_codes": dict(statuses), "latency_ms": {"p50": percentile(.5), "p95": percentile(.95), "p99": percentile(.99), "max": round(max(latency), 2)},
        "note": "Gerçek HTTP ölçümü. 429 hız sınırı, 409 stok/kuyruk sınırı; 0 bağlantı hatası. Checkout gerçek test siparişleri bırakır."}
    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
