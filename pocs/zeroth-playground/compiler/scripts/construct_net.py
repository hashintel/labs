"""Imports the compiled net.py in the folder given and says whether the net constructs.

Importing net.py builds every module class and the composed system, so a construction
that zrth refuses raises there. The result is one line of JSON on stdout: `ok`, and on a
raise the error with the lines of the generated files it passed through, outermost first.
Run it from a zrth checkout: `uv run --no-sync python construct_net.py <folder>`.
"""

import importlib
import json
import os
import sys
import traceback

from zrth import Module


def generated_frames(error: BaseException, folder: str) -> list[dict]:
    """The frames of the traceback that sit in the compiled files, outermost first."""
    return [
        {"file": os.path.relpath(frame.filename, folder), "line": frame.lineno, "code": frame.line}
        for frame in traceback.extract_tb(error.__traceback__)
        if os.path.abspath(frame.filename).startswith(folder + os.sep)
    ]


def construct(folder: str) -> dict:
    sys.path.insert(0, folder)
    try:
        net = importlib.import_module("net").net
        if not isinstance(net, Module):
            return {"ok": False, "error": f"net is a {type(net).__name__}, not a zrth Module", "frames": []}
        return {"ok": True}
    except Exception as error:  # every raise is a result to report, whatever its type
        return {"ok": False, "error": f"{type(error).__name__}: {error}", "frames": generated_frames(error, folder)}


if __name__ == "__main__":
    print(json.dumps(construct(os.path.abspath(sys.argv[1]))))
