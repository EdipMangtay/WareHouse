"""Source-checkout entrypoint. Installed cores can also be imported directly."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages"))

