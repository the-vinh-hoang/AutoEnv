---
title: Configure GitHub remote and automated build
date: 2026-10-27
summary: Configured origin and added a SHA-pinned GitHub Actions build with extension artifacts; validated on Node 22.
---

# Configure GitHub remote and automated build

## Changes
Configured origin as https://github.com/the-vinh-hoang/AutoEnv.git. Added .github/workflows/build.yml for push, pull_request and manual dispatch. The workflow uses Node 22, npm ci, npm test and npm run build, then uploads dist as autoenv-extension. Official actions are pinned to verified release commit SHAs; token permissions are read-only and checkout credentials are not persisted. README links the workflow and explains artifact retrieval and internal-catalog handling.

## Verification
Verified published action tags and required inputs. actionlint 1.7.12 passed with no findings; the downloaded validator checksum matched the published SHA-256 digest and its temporary directory was removed. Executed the workflow npm commands under Node 22.23.4: clean installation succeeded, all 38 tests passed, and dist was rebuilt.

## Delivery boundaries
No commit or push was requested or performed. The hosted GitHub workflow has not run; it starts once the workflow is committed and pushed. No release, store publishing or application behavior changes.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
