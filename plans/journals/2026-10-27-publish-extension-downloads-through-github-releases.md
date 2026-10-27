---
title: Publish extension downloads through GitHub Releases
date: 2026-10-27
summary: Published the verified extension ZIP and added master-only automatic release publishing with a stable anonymous download link.
---

# Publish extension downloads through GitHub Releases

## Outcome
Published AutoEnv build 1 as https://github.com/the-vinh-hoang/AutoEnv/releases/tag/build-1-1 from the successful build at ccf565186d04bea14f1f66b5602ff678816afcc5. The release includes the verified install-ready autoenv-extension.zip.

## Changes
Added a release job in .github/workflows/build.yml after the existing build job. Only master push/manual runs publish; pull requests remain read-only artifact builds. The release job downloads the tested artifact, packages it with manifest.json at ZIP root, and attaches it to a uniquely tagged release using the workflow run number and attempt. Write permission is scoped to the release job. README.md now points users to Releases and the stable latest-download URL, with unpacked Chrome installation instructions.

## Verification
Actionlint passed. Executed the ZIP packaging command on the previously downloaded successful build artifact and verified all runtime files and bundled XMLs were included. The anonymous latest-download URL returned HTTP 200; downloaded ZIP SHA-256 01121cebb7b354e800840df57783dfc298fd6126b561cef776277e3e1c6967d8 matches the uploaded package. Confirmed the published target commit and inspected the anonymous GitHub release page showing Latest and the extension ZIP under Assets.

## Activation
Workflow and README changes are local and uncommitted; no commit or push was performed. Push the workflow changes to enable future automatic publishing. The new hosted release job has not run yet; the initial release was published directly using the same packaging and gh release create route.

AgentWiki publish skipped.

> Historical work record — not durable authority. Prefer docs/specs/ADRs for current decisions.
