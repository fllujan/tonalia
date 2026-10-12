"""Inference code of Demucs 4.1.0 (MIT, Meta Platforms), vendored.

Only change: ``apply.py`` imports ``tqdm`` lazily (it is used for console progress only).

Only the modules needed to run the pretrained models are kept (no audio I/O, training
or download code), so the engine depends on torch, einops and julius alone. See
LICENSE in this folder and docs/third-party.md.
"""
