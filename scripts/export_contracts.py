"""Generate/check the versioned JSON wire schema from the canonical Python boundary."""
from pathlib import Path
import argparse
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/"packages"))
from pydantic import TypeAdapter
from contracts.research import Command, CreateSession, SessionFrame

parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true")
args = parser.parse_args()
path = ROOT/"packages/contracts/research.schema.json"
schemas = dict(command=TypeAdapter(Command).json_schema(), create=CreateSession.model_json_schema(),
               frame=SessionFrame.model_json_schema())
content = json.dumps(schemas, indent=2, ensure_ascii=False)+"\n"
if args.check:
    if not path.is_file() or path.read_text() != content:
        raise SystemExit("Contract schema is stale: run scripts/export_contracts.py")
    print("Contract schema is current")
else:
    path.write_text(content)
    print(path)
