#!/usr/bin/env python3
"""Compile canonical navigation and validate every access, spawn and connected zone."""
import argparse
import json
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/api'))
from app.sim.navgrid import load_layout

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preset',choices=['small','medium','large','mega','legacy','all'],default='all')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args();reports={}
    for name in ['small','medium','large','mega'] if args.preset=='all' else [args.preset]:
        source=ROOT/'apps/api/app/warehouse_layout.json' if name=='legacy' else ROOT/f'shared/layouts/{name}.json'
        layout=load_layout(source);graph=layout['navigation_graph']
        reports[name]=dict(layout_revision=layout['revision'],nodes=len(graph['nodes']),sha256={k:v['sha256'] for k,v in graph['floors'].items()},**graph['validation'])
        print(f"{name}: {'PASS' if graph['validation']['valid'] else 'FAIL'} · {len(graph['nodes'])} operational nodes · {graph['validation']['floors']}")
        if not graph['validation']['valid']: print(json.dumps(graph['validation'],ensure_ascii=False))
    if args.output:
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(reports,indent=2,ensure_ascii=False)+'\n')
    sys.exit(0 if all(r['valid'] for r in reports.values()) else 1)
