---
title: Discover ORBIS PROXY products and update on startup
date: 2026-11-06
summary: Replace fixed proxy product mappings with per-host collector caches and automatic catalog/route updates.
---

# Discover ORBIS PROXY products and update on startup

## What changed
- Removed fixed u/iris proxy mappings; component, proxy-location and proxy-port now drive per-host autocomplete and navigation allowlists. Static OAS/FHIR rules and Jira remain.
- Added a compact persisted route cache with bounded collection, last-successful retention on failures, removal on successful empty responses, and safe path/port validation.
- Replaced refresh with update, ranked it first for empty ae queries, and triggered updates on installation/reload and browser startup. Catalog failures still allow discovery from the saved/bundled inventory.
- Updated README for discovery, automatic/manual updates, offline limits and expanded HTTPS permissions. No active plan resolved; the earlier completed implementation plan remains historical.

## Verification and corrections
- Initial narrow suite passed 45/47: two new no-routes expectations incorrectly assumed u could not prefix-match static ucc. Advisory review confirmed the tests were wrong; corrected expectations and added a proxy-only no-guess boundary.
- Regression review also fixed discovered Jira-named products in product-first order, independent route discovery when XML downloads fail, and interrupted update status.
- Final npm test: 66 passed, zero failures. npm run build succeeded.
- Isolated Chrome 157 automatically downloaded 506 live environments and collected 143 of 219 proxy hosts; 76 unavailable hosts were reported as partial. Stored data used 6,070,952 bytes. POCH4446 iris-tracing, grafana and erp-4u resolved to their exact collected paths and passed the destination allowlist in the service-worker CDP context.
- Native omnibox typing could not be automated and is unverified in this session. Boundary integration tests cover empty-query update ranking, startup events and navigation. Destination applications were not opened. Temporary browser/profile and smoke helpers were removed.

## Decisions and limits
- Unnamed collector entries are skipped rather than inventing product names. Nondefault ports and trailing slashes are preserved. No guessed legacy proxy fallbacks.
- Chrome may require approval for expanded host permissions on upgrade. Rebuild and reload dist to use these changes. No commit, release or publication performed.
- AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
