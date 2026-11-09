---
title: Read approved ORBIS collector tabs when worker TLS fails
date: 2026-11-06
summary: Use the exact open collector document as a route source without changing certificate trust.
---

# Read approved ORBIS collector tabs when worker TLS fails

## Cause
Chromium Manifest V3 service-worker fetch does not reuse saved tab certificate exceptions (Chromium issue 40882068). The user can view the collector in Edge after approving its warning.

## Change
Added a direct-request failure fallback in src/background.js that reads JSON from an already-open exact collector URL using an isolated main-frame script. Added scripting permission without broadening host access. No tabs are opened and no certificate settings are changed. Existing route validation, atomic persistence and last-successful cache behavior are reused. README documents the reload, same-profile collector tab, update, status and PAS-query workflow.

## Evidence and limits
All 69 tests pass; the extension builds successfully. Regression checks cover recovery from a readable collector, persistence after tab closure, host/navigation/warning/HTML/JSON rejection, and empty-route replacement. In isolated Edge, the explicitly approved live QOUK0804 collector rendered raw JSON in a pre element and reported pas at /u/pas/ on port 443. Full installed-extension/omnibox verification was not completed: CDP extension inspection did not expose a usable AutoEnv worker. Excessive CDP investigation did not prove the user-profile result; stopped it rather than claiming success. The temporary smoke browser was closed.

## Decision
Do not disable TLS validation or automatically accept warnings. To refresh through a saved exception, reload the collector page and keep it open during update in the same profile. For unattended collection, IT must establish CA trust or repair the server certificate. AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
