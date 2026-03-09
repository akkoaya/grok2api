#!/usr/bin/env python3
"""
Verify that the model catalog in src/index.ts stays in sync with the
Python ModelService in app/services/grok/services/model.py.

Exit 0 if they match, exit 1 otherwise.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PYTHON_MODEL_FILE = ROOT / "app" / "services" / "grok" / "services" / "model.py"
WORKER_FILE = ROOT / "src" / "models.ts"


def extract_python_model_ids() -> list[str]:
    """Parse model_id values from the Python ModelService.MODELS list."""
    text = PYTHON_MODEL_FILE.read_text(encoding="utf-8")
    return re.findall(r'model_id\s*=\s*"([^"]+)"', text)


def extract_worker_model_ids() -> list[str]:
    """Parse id values from the TypeScript MODEL_CATALOG array.

    Looks between the sentinel comments __MODEL_CATALOG_START__ and
    __MODEL_CATALOG_END__ to avoid false positives elsewhere in the file.
    """
    text = WORKER_FILE.read_text(encoding="utf-8")
    m = re.search(
        r"__MODEL_CATALOG_START__(.+?)__MODEL_CATALOG_END__",
        text,
        re.DOTALL,
    )
    if not m:
        print("ERROR: Could not find __MODEL_CATALOG_START__/__MODEL_CATALOG_END__ in src/models.ts")
        sys.exit(1)

    block = m.group(1)
    return re.findall(r'id:\s*"([^"]+)"', block)


def main() -> None:
    py_ids = extract_python_model_ids()
    ts_ids = extract_worker_model_ids()

    py_set = set(py_ids)
    ts_set = set(ts_ids)

    ok = True

    only_python = py_set - ts_set
    only_worker = ts_set - py_set

    if only_python:
        print(f"Models in Python but missing from Worker: {sorted(only_python)}")
        ok = False

    if only_worker:
        print(f"Models in Worker but missing from Python: {sorted(only_worker)}")
        ok = False

    # Also verify ordering matches
    if py_ids != ts_ids:
        print(f"Model ordering differs:")
        print(f"  Python : {py_ids}")
        print(f"  Worker : {ts_ids}")
        ok = False

    if ok:
        print(f"OK: {len(py_ids)} models in sync between Python and Worker")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
