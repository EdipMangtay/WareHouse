"""Select a generated warehouse for the frontend. Restart BOTH services afterwards."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/api'))

def activate(preset: str) -> dict:
    from app.sim.navgrid import load_layout
    source = ROOT / 'apps/api/app/warehouse_layout.json' if preset == 'legacy' else ROOT / f'shared/layouts/{preset}.json'
    data = load_layout(source)
    # Slot addresses remain in the canonical backend layout. The renderer needs geometry,
    # picking access locations and counts, not tens of thousands of inventory address rows.
    data.pop('storage_slots', None)
    target = ROOT / 'apps/web/src/layout/active_layout.json'
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    return data

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('preset', choices=['small', 'medium', 'large', 'mega', 'legacy'])
    args = parser.parse_args()
    selected = activate(args.preset)
    print(f"Warehouse: {args.preset} | {selected['size']['width']} × {selected['size']['depth']} m | {len(selected['racks'])} racks")
