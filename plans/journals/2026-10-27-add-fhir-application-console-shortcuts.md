---
title: Add FHIR application console shortcuts
date: 2026-10-27
summary: Added exact FHIR console mappings with offline cache re-indexing; 38 tests pass and dist rebuilt.
---

# Add FHIR application console shortcuts

## Changes
Added fhir and fhir-back-end products using separate exact OAS application software hosts, HTTPS port 9993 and /console/index.html. Cache version 2 re-indexes saved XML on upgrade without network access or loss of catalog dates. Updated README and the existing plan contract.

## Verification
38 behavioral tests pass; unpacked dist rebuilt. Tests cover exact fhir precedence, missing software, destination safety and legacy-cache migration including storage failure/retry and worker restart. Real bundled catalogs contain 34 FHIR and 32 back-end records; DOD0804F resolves to LS003843 and LS003844 respectively. Isolated Chrome 149 loaded all 464 records with both host arrays. Native ae+Tab+dod0804f fhir displayed the expected console URL through UI Automation. Destination applications were not contacted.

## Tooling
Eval Bun could not resolve the project parser dependency; the same catalog smoke succeeded under project Node. Native foreground activation failed until focusing the address field directly; safe foreground checks preceded SendKeys. A delayed desktop screenshot did not show the controlled browser, so it was discarded rather than used as evidence. Isolated Chrome closed.

## Delivery
Reload the unpacked extension after rebuilding; existing XML is re-indexed automatically. No commits or publication.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
