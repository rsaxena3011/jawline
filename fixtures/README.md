# Fixtures convention

YouCam result URLs (try-on renders, skin masks) expire, and the
retention window is one of the figures the day-1 probe must settle
(the plan saw claims of 2 hours, 24 hours, and 30 days). The rule
that survives every version: **mirror every returned image locally at
capture time; never store a bare result URL and hope it lives.**

## Layout

| What | Where |
| --- | --- |
| Raw API response JSON for a capture | `fixtures/<capture-id>/response.json` |
| Mirrored result images | `public/fixtures/<capture-id>/<name>` |
| Manifest of mirrored images | `public/fixtures/manifest.json` |

`lib/fixtures/mirror.ts` does the mirroring: `mirrorResultImage(url,
{ captureId, name, kind })` downloads the image, stores it at the
conventional path, and records it in the manifest (id, kind, source
URL, local web path, capture time, byte count). Re-mirroring the same
id replaces the entry.

## Capture ids

One capture id per photo session, e.g. `study-p03-daylight` or
`demo-happy-path`. Names inside a capture say what the image is:
`vto-shade-a.png`, `mask-oiliness.png`, `capture-original.jpg`.

## Consent rule (hard)

Mirrored images can show real faces. Perfect Corp takes promotional
rights on submitted material, and study faces are volunteers, so:
mirrored binaries are **git-ignored by default** and stay local until
written consent for that person is on file. The manifest (which names
files but holds no images) is safe to commit. Response JSON committed
to the repo must be redacted of anything personal and must never
include the API key.
