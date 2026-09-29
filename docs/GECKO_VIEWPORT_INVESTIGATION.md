# Service-only Gecko viewport investigation

Investigated 2026-09-29. No app changes, builds or device tests performed.

## Finding

The service creates BrowserEngine and opens GeckoSession, sets it inactive, installs the extension and loads home. It never acquires GeckoDisplay or supplies a Surface with dimensions. MainActivity alone creates GeckoView and attaches the session. This is a concrete missing initialization step on the cold-start path.

Mozilla's GeckoSession source assigns mWidth/mHeight from SurfaceInfo in onSurfaceChanged and propagates those bounds to the compositor. Inspection of the cached 155.0.20260903215306 AAR showed the same assignments and the public APIs listed below. The zero viewport at boot is consistent with no surface ever being supplied; opening the Activity supplies dimensions, explaining the observed contrast with later hidden operation. DOM viewport dimensions are CSS pixels, not necessarily equal to surface pixel dimensions.

## Candidate implementation, not yet validated

Provide a service-owned offscreen rendering target before initial navigation:

1. Create a bounded Android ImageReader-backed Surface (candidate size 720x1280 physical pixels, appropriate supported format/usage to be verified on device).
2. On the main thread acquireDisplay and call surfaceChanged with new GeckoDisplay.SurfaceInfo.Builder(surface).size(width,height).build().
3. Drain and close produced images without reading, exporting or persisting pixel data. A full image queue can stall the producer; lifecycle cleanup must close the reader.
4. Keep actual Activity visibility separate from display ownership. Initially retain inactive state while hidden; do not assume a surface removes background scheduling limits or forces X to render.
5. Hand display ownership to GeckoView before attaching the visible Activity: surfaceDestroyed, releaseDisplay, dispose offscreen target, then attach view. Reverse the handoff after releasing the view when its screen is removed. One acquired display at a time; prevent old Activity callbacks releasing a newer owner's surface.
6. Retain ordinary app-private profile. No Activity auto-launch, overlay, ADB connection or lock bypass is part of this experiment.

Verified signatures from cached dependency: GeckoDisplay.surfaceChanged(SurfaceInfo), SurfaceInfo.Builder(Surface).size(int,int).build(), GeckoSession.acquireDisplay/releaseDisplay, ContentDelegate.onCrash/onKill/onFirstComposite/onFirstContentfulPaint. Public API availability is not proof that a chosen offscreen surface works with this device's compositor.

## Separate bridge-lifetime issue

Boot evidence shows extension connection at 18:27:46.512Z, then disconnect at 18:27:49.117Z. No crash/kill delegate is currently implemented (empty ContentDelegate); there is also no reconnect handler in content.js. Zero viewport does not prove the reason for port loss.

Instrument onCrash/onKill, first composition/paint, display ownership and dimensions, accepted/rejected port connection, and session-open state. Do not add reload/retry loops before classifying failure. If recovery is later added, bound it and never replay delivered scroll commands. An Android foreground service does not by itself establish Gecko child-process health.

## Acceptance

Use a fresh service-only process without opening Activity. First validate a controlled local page's nonzero innerWidth/innerHeight and DOM command response, then X home read/scroll. Require new boot process, hidden Activity throughout, stable bridge, nonzero viewport and actual text counts/movement. A heartbeat, successful engine load, or surface dimensions alone cannot pass. Screen-off/Doze and network changes remain separate tests.

## Sources and inspection limits

- [GeckoDisplay surface contract](https://mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/GeckoDisplay.html)
- [GeckoSession display ownership and visibility](https://mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/GeckoSession.html)
- [GeckoSession source](https://raw.githubusercontent.com/mozilla-firefox/firefox/refs/heads/main/mobile/android/geckoview/src/main/java/org/mozilla/geckoview/GeckoSession.java)
- [ContentDelegate crash/kill callbacks](https://mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/GeckoSession.ContentDelegate.html)
- [Android ImageReader](https://developer.android.com/reference/android/media/ImageReader)

Online Mozilla docs currently describe 159, so local 155 signatures/bytecode were also inspected. Extracted dependency classes are in results/gecko-api-inspection.jar. javap printed relevant signatures/bytecode but exited with an internal AccessDeniedException afterward; this inspection is not a clean verification command, compile, or runtime test. Two attempted upstream test-rule source URLs could not be fetched; no upstream offscreen test was verified.
