# Reader window benchmark

Run from `frontend/ProjectF`:

```powershell
npm run benchmark:reader
```

The benchmark opens a position at 82% of synthetic 1, 5, and 10 million
character books. It reports manifest/window preparation, then materializes only
the target section and its immediate neighbors and reports median and p95 opening
time, selected units and characters, and the retained Node.js heap delta after
forced garbage collection. Network, JSON parsing, DOM layout and paint are not
part of these timings.

The heap figure is a repeatable regression signal for reader data structures, not
a browser memory measurement. It excludes DOM/layout/image decoder/GPU memory and
is affected by V8 string representation and garbage collection. Browser memory
must be profiled separately in a stable Chromium build with the same book,
viewport, cache state, and measurement protocol.
