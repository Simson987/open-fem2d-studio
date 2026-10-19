"""Reproducible baseline for the current Rust Q4 sparse solver.

The 1 m square membrane is fixed on its left edge and carries a total 1 kN
horizontal load on its right edge. The script checks equilibrium and the true
solver residual while recording wall time and peak resident memory. Timings
include JSON input/output and use the existing debug binary, so they are a
baseline for comparing solver backends rather than production benchmarks.

Run: python3 scripts/verification/benchmark_native_quad2d.py --sizes 20 40 60
"""

import argparse
import json
import subprocess
import tempfile
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BINARY = ROOT / "src-tauri/target/debug/native-quad2d"


def request_for_grid(cells):
    stride = cells + 1
    nodes = [
        {"id": row * stride + column + 1, "x": column / cells, "y": row / cells}
        for row in range(stride) for column in range(stride)
    ]
    quads = []
    for row in range(cells):
        for column in range(cells):
            first = row * stride + column + 1
            quads.append({
                "id": len(quads) + 1,
                "nodeIds": [first, first + 1, first + stride + 1, first + stride],
                "materialId": 1,
                "thicknessM": 0.1,
            })
    return {
        "analysis": "linear",
        "nodes": nodes,
        "materials": [{"id": 1, "eMpa": 210_000, "nu": 0.3}],
        "quads": quads,
        "supports": [
            {"nodeId": row * stride + 1, "ux": True, "uy": True}
            for row in range(stride)
        ],
        "loads": [
            {"nodeId": row * stride + cells + 1, "fx": 1 / stride, "fy": 0}
            for row in range(stride)
        ],
    }


def run_case(binary, cells, timeout):
    request = request_for_grid(cells)
    with tempfile.TemporaryDirectory(prefix="native-quad-benchmark-") as directory:
        memory_file = Path(directory) / "peak-kib.txt"
        started = time.perf_counter()
        completed = subprocess.run(
            ["/usr/bin/time", "-f", "%M", "-o", str(memory_file), str(binary)],
            input=json.dumps(request), text=True, capture_output=True, timeout=timeout,
            check=False,
        )
        elapsed = time.perf_counter() - started
        peak_mib = int(memory_file.read_text().strip()) / 1024
    result = json.loads(completed.stdout)
    if completed.returncode:
        raise RuntimeError(f"{cells}x{cells} Q4: {result.get('error', completed.stderr)}")
    residual = result["relativeResidual"]
    reaction_x = sum(node["rxKn"] for node in result["nodes"])
    reaction_y = sum(node["ryKn"] for node in result["nodes"])
    if residual > 1e-8 or abs(reaction_x + 1) > 1e-7 or abs(reaction_y) > 1e-7:
        raise RuntimeError(
            f"{cells}x{cells} Q4 failed equilibrium: residual={residual}, "
            f"Rx={reaction_x}, Ry={reaction_y}"
        )
    print(
        f"{cells}x{cells} Q4 | {2 * len(request['nodes'])} DOF | "
        f"{elapsed:.2f} s | {peak_mib:.1f} MiB | "
        f"residual={residual:.2e} | Rx={reaction_x:.8f} kN",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sizes", nargs="+", type=int, default=[20, 40, 60])
    parser.add_argument("--timeout", type=int, default=180)
    parser.add_argument("--binary", type=Path, default=DEFAULT_BINARY)
    options = parser.parse_args()
    if not options.binary.is_file():
        parser.error(f"native Q4 binary is missing: {options.binary}")
    if any(size < 1 for size in options.sizes):
        parser.error("grid sizes must be positive")
    for size in options.sizes:
        run_case(options.binary, size, options.timeout)


if __name__ == "__main__":
    main()
