---
title: Package AutoEnv 1.3.0
date: 2026-11-09
summary: Bump release metadata to 1.3.0 and create the verified loadable ZIP in dist.
---

# Package AutoEnv 1.3.0

## Request and changes
The requested Git status was clean on master, tracking origin/master. Updated manifest.json, package.json and the root package-lock.json metadata from 1.0.0 to 1.3.0. Built the extension and packaged dist/autoenv-extension.zip with manifest.json at its root. No commit, tag, push or publication was requested or performed.

## Verification
All 69 tests passed and npm run build succeeded. ZIP CRC validation passed. The archive contains exactly manifest.json, background.js and the two bundled XML catalogs; every archived file matches the built file byte-for-byte. The packaged manifest reports 1.3.0. Archive size: 188409 bytes. This packaging check does not change the previously reported unverified real-profile Edge omnibox path.

AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
