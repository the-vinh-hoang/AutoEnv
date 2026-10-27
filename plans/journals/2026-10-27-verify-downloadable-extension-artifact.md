---
title: Verify downloadable extension artifact
date: 2026-10-27
summary: Confirmed the successful GitHub build already provides a complete downloadable extension; no workflow repair needed.
---

# Verify downloadable extension artifact

## Diagnosis
The requested downloadable artifact already exists. GitHub run 40521920141 on master completed successfully and published unexpired autoenv-extension artifact 12742102378. The existing workflow uploads the contents of dist, and README already describes the Actions artifact installation route. No application or workflow change is needed.

## Verification
Downloaded the actual hosted artifact with gh run download into a temporary directory. It contains manifest.json, bundled background.js and both data XML files directly at the archive root; no source checkout, Node installation or build is required by end users. Isolated Chrome 149 registered this downloaded package as ENABLED, with empty manifestErrors and runtimeErrors. Worker inspection encountered inactive-worker No SW errors; the Chrome extension registration/error metadata and screenshot were used to verify package loading instead.

## User guidance
Open the successful run, download autoenv-extension under Artifacts while signed into GitHub, extract the ZIP, enable Developer mode at chrome://extensions and Load unpacked the extracted directory containing manifest.json. Actions artifacts expire and require GitHub login; they are not one-click Chrome Web Store installers. No release, store publishing, commit or push was performed.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
