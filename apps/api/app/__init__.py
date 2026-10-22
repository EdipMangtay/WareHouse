"""Application bootstrap for source checkout and compatibility backend entrypoint."""
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages"))
