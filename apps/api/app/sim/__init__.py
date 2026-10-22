"""Portable compatibility package for app.sim imports.

Implementation files live in warehouse_core.legacy; no duplicate operation code.
"""
from warehouse_core import legacy as _legacy
__path__ = _legacy.__path__
