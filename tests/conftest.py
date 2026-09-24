"""Makes `import cleaner` work regardless of how pytest is invoked, by putting the repo
root (the parent of this tests/ directory, where cleaner.py lives) on sys.path.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

FIXTURES = Path(__file__).resolve().parent / "fixtures"
