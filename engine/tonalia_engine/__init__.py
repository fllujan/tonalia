"""Tonalia analysis engine."""

import os

# One BLAS thread per process, set before numpy loads. The analysis already runs one
# process per core, and the OpenBLAS that numpy ships for Intel Macs can deadlock when
# several Python threads (the duplicate scan, the set render) call it at once.
for _var in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS"):
    os.environ.setdefault(_var, "1")

__version__ = "0.2.0"
PROTOCOL_VERSION = 1
