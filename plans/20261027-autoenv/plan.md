---
title: AutoEnv omnibox extension
status: completed
---

# AutoEnv implementation

## Outcome
Build a Chrome Manifest V3 extension for ORBIS endpoint autocomplete and fixed Jira shortcuts. The user explicitly clarified: URL area ONLY, like Chrome site search activated by a keyword followed by Tab. NO popup, launcher tab, or alternate UI.

## Decisions and constraints
- Vanilla JavaScript service worker, esbuild, locally bundled fast-xml-parser; no remote code.
- Chrome omnibox keyword `ae` (Tab/Space activation). No action/default_popup or HTML pages.
- Explicit omnibox commands: `refresh` downloads both XML files; `status` shows dates/count/last refresh outcome in the suggestion area; `help` explains input. No periodic downloads, notifications, telemetry, commits or publishing.
- Real snapshots bundled in `data/`; raw XML plus index stored in chrome.storage.local. Validate both downloaded sources before replacing one snapshot. Failed download/validation/storage write retains prior catalog.
- Preserve all environment types for AU, DACHL, FR, UKI, retaining type/source/region labels. Missing exact software entries do not generate guessed endpoints. Preserve distinct host alternatives.
- OAS software exact name `OAS - CON - standard:single`: webstart/bpe -> HTTPS :8443/webstart; ucc -> :8443/ucc; oas/console -> :9993/console/index.html.
- FHIR consoles: `fhir` uses exact `OAS - APP - application:fhir`; `fhir-back-end` uses exact `OAS - APP - application:fhir-back-end`. Both produce HTTPS :9993/console/index.html, without substituting the standard OAS or proxy host.
- ORBISU exact software name `ORBIS PROXY` (not `ORBISU PROXY`): u -> /u; iris -> /u/iris; iris-tracing -> /u/iris-tracing; iris-fhir -> /u/iris-fhir. HTTPS default port.
- Case-insensitive database/product, either order, prefix suggestions. Jira aliases exactly requested. Bare alias shows complete prefix suggestion; Down selects it, End positions the cursor for ticket digits. API cannot forcibly replace the field before user selection or leave an accepted prefix editable after Enter; incomplete tickets never navigate or open replacement UI.
- Unknown/ambiguous Enter leaves current tab unchanged; selecting a concrete result navigates. Honor current/new foreground/background disposition.

## Constants and module contracts
`src/catalog.js` exports `SOURCES` = [{id,label,url,file}], and `parseEnvironments(xml, sourceId)` => `{updatedAt:string, records:Record[]}`. Record = `{id,sourceId,type,region,db,oasHosts:string[],proxyHosts:string[],fhirHosts:string[],fhirBackEndHosts:string[]}`.
- qa: label QA / PreQA; https://environments.orbis.dedalus.com/xml/environments.xml; file environments.xml
- dev: label DEV; https://environments.orbis.dedalus.com/xml/environments_dev_fra.xml; file environments_dev_fra.xml
Parser validates XML/root/schema, rejects DTD/entities and invalid hosts. Record id distinguishes source/type/region/database and duplicate rows.

`src/resolve.js`: `suggest(query, records, limit=30)` => `{kind:'endpoint'|'jira'|'jira-prefix',title,description,url,completion,region?,type?,sourceId?,db?,product?}[]`; completion is full URL. `isAllowedDestination(url,records)` permits generated endpoints and numeric fixed-project Jira tickets only.
Jira base https://dedalus.atlassian.net/browse/: bug/orbisbug/defect => ORBISBUG-; hconn/story => HCONN-; hepic/epic => HEPIC-. Recognize full prefix URL + numeric ID for completion.

`src/cache.js` owns offline initialization/persisted snapshot and transactional replacement. Cache version 2 re-indexes version 1 records from their saved XML without downloads, preserving source data, bundled/downloaded state and dates; migration is persisted before use. `src/background.js` owns omnibox commands and navigation.

## Phases
1. Catalog/resolver: safe XML parser, exact host rules, prefix/ambiguity handling, Jira aliases, behavioral edge tests.
2. Integration: cache, transactional refresh, service-worker omnibox-only UI, deterministic build.
3. Verification: behavioral tests/build, isolated Chrome smoke with real snapshots and manual refresh; review/security, installation/usage docs.

## Acceptance
- Both qouk4442 iris and iris qouk4442 resolve https://QOUK4442-U.DEDALUS.LAN/u/iris from real XML.
- All endpoint rules/Jira aliases; prefix completion; no fabricated hosts; ambiguous distinct hosts selectable.
- Offline first run and persistent cache across worker restart. Successful refresh saves both raw files; failed refresh preserves last working pair.
- Only URL-area interaction; commands expose update/status without popup/tab/notification UI.
- Build loadable unpacked without external runtime dependencies or broad browsing permissions.
- Document Chrome limitation on force-editing Jira prefixes honestly; direct alias + number works entirely in address bar.

## Verification evidence
- `npm test`: 35 behavioral tests pass. `npm run build`: unpacked extension built in dist/. `npm audit --omit=dev`: no vulnerabilities reported.
- Isolated Chrome 149 loaded both raw XML copies and 464 records (QA103, DEV361), using 5,443,176 storage bytes at initial load.
- Native ae+Tab endpoint input produced the expected URL, and inverse-order Enter generated the same navigation. Destination requests were intercepted before external access; application login/reachability is not claimed.
- Native Jira prefix selection (Down, End, ticket digits) remained editable in the address bar; Enter generated the expected ORBISBUG ticket navigation, intercepted before network access.
- Native refresh downloaded both real sources successfully without opening a page. A forced-offline refresh failed and left the stored catalog byte-for-byte unchanged. Chrome Reload restarted the worker; status retained the downloaded catalog and last attempt result.
- Independent parser/resolver review found no actionable defects. Integration review repaired stale async status replacement and false rollback reporting after a committed refresh; regression tests cover both boundaries.
- Canonical duplicate destinations collapse before limits, retaining the first label; distinct targets remain selectable. Exact product names win over partial matches.
- README covers installation, command usage, no-popup scope, permissions, missing exact software entries, and the verified inline Jira workflow. Local journal created; no commits or publication.

## FHIR console extension verification
- `npm test`: 38 tests pass, including exact FHIR precedence, separate application hosts, missing-software behavior, allowed destinations, and offline migration with a storage-failure retry and worker restart.
- `npm run build`: rebuilt the unpacked extension in `dist/`.
- Real bundled snapshots contain 34 records with FHIR application hosts and 32 with FHIR back-end hosts. `DOD0804F fhir` resolves to https://LS003843.DEDALUS.LAN:9993/console/index.html; `DOD0804F fhir-back-end` resolves to https://LS003844.DEDALUS.LAN:9993/console/index.html.
- Isolated Chrome 149 loaded cache version 2 with all 464 records and both FHIR host arrays. Native `ae` + Tab + `dod0804f fhir` displayed the expected console URL. Destination applications were not contacted.
