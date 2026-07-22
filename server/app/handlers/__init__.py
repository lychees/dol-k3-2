"""Handler-package bootstrap.

Every module in this package that defines `register(registry, container)`
is discovered automatically (plugin pattern): drop a new file here and its
packet types go live — no edits anywhere else.
"""
import importlib
import pkgutil


def discover_registrars():
    registrars = []
    for info in pkgutil.iter_modules(__path__):
        if info.name.startswith("_"):
            continue
        module = importlib.import_module(f"{__name__}.{info.name}")
        register = getattr(module, "register", None)
        if callable(register):
            registrars.append(register)
    return registrars
