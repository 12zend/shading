# Movie draw submission performance

Adjacent cached Movie sources now share a renderer draw region. The framebuffer,
shader program and vertex attributes are set once until the framebuffer, shader,
or renderer region changes. Each object still draws immediately with its own
viewport, uniforms, texture sampling and effect bounds; no VM yield or deferred
publication is introduced. Offstage objects skip GL setup entirely.

Mutable video/model sources retain immediate binding. Extending region reuse to
uploads regressed native GPU timings, so these sources explicitly bypass it.
Frame/group transactions and external renderer operations invalidate the region.

## Measurement (2026-09-21)

Native WebGL, existing `scripts/benchmarks/movie-renderer.cjs`, three warmups and
seven measured samples, median total milliseconds. Baseline is commit 8795d4889;
only the changed draw target was substituted for the baseline run.

| Cached source | Draws | Before | After |
| --- | ---: | ---: | ---: |
| Polygon | 1000 | 49.72 | 19.64 |
| Line | 1000 | 50.60 | 18.18 |
| Text | 1000 | 54.70 | 30.05 |

All six benchmark scenarios produced identical framebuffer SHA-256 values,
zero GL errors and zero Promise returns. The native model backend emits a
texture compatibility warning in both versions, so model image equality is not
a substitute for browser model validation. Timings are synthetic throughput,
not an end-to-end project FPS guarantee. Video/model timing varied substantially;
this change does not claim to optimize decoding or 3D rendering.

Regression coverage checks 1000 adjacent draws with a single binding setup,
shader/framebuffer/external-draw transitions, mutable-source transitions, and
stroke flushing. Existing Movie frame/graph and effect tests cover transactions.
