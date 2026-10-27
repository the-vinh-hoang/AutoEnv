# AutoEnv

Address-bar-only Chrome autocomplete for ORBIS environment endpoints and Dedalus Jira tickets. There is no popup at all: no HTML page, launcher tab, notifications, or server. Lookup works offline from bundled XML snapshots.

## Install

Build with Node.js 22+; run with Chrome 120+ (requirements: [package.json](package.json) and [manifest.json](manifest.json)).

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose **`dist`** (not the repository root). After changing source, rebuild and click Reload on the extension card. Teammates can load a copy of the complete built `dist` folder without Node.js.

## Address-bar usage

Type **`ae`**, press **Tab** (or Space), then type a query. This uses Chrome's built-in keyword/site-search interaction, like typing `google.com` then Tab. Chrome requires the activation keyword; the extension does not intercept unrelated address-bar input.

```text
qouk4442 iris
iris qouk4442
QOAT4442 webstart
bug 12345
story 12345
```

Choose a suggestion with the arrow keys and press Enter. A unique complete match also opens on Enter. Partial database and product names show completions. Region, environment type and catalog labels distinguish matches. An ambiguous/unknown query or unfinished Jira link never navigates to a guessed target or sends internal names to web search. Chrome's current-tab/new-tab/background-tab disposition is respected.

Duplicate catalog records that resolve to the same canonical URL produce one suggestion, retaining the first record's label. Genuinely distinct target URLs remain separate choices. Matching and deduplication are owned by [src/resolve.js](src/resolve.js).

### Endpoint rules

All URLs use HTTPS, hosts come from exact software entries in the XML, and matching is case-insensitive. No host is inferred from a database name.

| Product / aliases | Exact XML software | Port | Path |
| --- | --- | --- | --- |
| `webstart`, `bpe` | `OAS - CON - standard:single` | 8443 | `/webstart` |
| `ucc` | `OAS - CON - standard:single` | 8443 | `/ucc` |
| `oas`, `console` | `OAS - CON - standard:single` | 9993 | `/console/index.html` |
| `u` | `ORBIS PROXY` | 443 (implicit) | `/u` |
| `iris` | `ORBIS PROXY` | 443 (implicit) | `/u/iris` |
| `iris-tracing` | `ORBIS PROXY` | 443 (implicit) | `/u/iris-tracing` |
| `iris-fhir` | `ORBIS PROXY` | 443 (implicit) | `/u/iris-fhir` |

For example, the bundled catalog maps `qouk4442 iris` to `https://QOUK4442-U.DEDALUS.LAN/u/iris`. Chrome may lowercase hostnames because DNS is case-insensitive. Software names must match exactly: some DEV entries have an OAS application-server entry but lack `OAS - CON - standard:single`, so they have no OAS/webstart/UCC result. Hosts are not substituted from another software entry. The software-name rules live in [src/catalog.js](src/catalog.js); fixed endpoint and Jira mappings live in [src/resolve.js](src/resolve.js).

### Jira

| Shortcut / aliases | Fixed URL prefix |
| --- | --- |
| `bug`, `orbisbug`, `defect` | `https://dedalus.atlassian.net/browse/ORBISBUG-` |
| `hconn`, `story` | `https://dedalus.atlassian.net/browse/HCONN-` |
| `hepic`, `epic` | `https://dedalus.atlassian.net/browse/HEPIC-` |

A bare alias shows its URL prefix in the suggestion list. To fill the prefix first, type **`ae` → Tab → `bug` → Down arrow → End → ticket digits → Enter**. Down arrow selects the prefix suggestion and fills the address field with `https://dedalus.atlassian.net/browse/ORBISBUG-`; End places the cursor after the hyphen so you can append the ticket number entirely in the address bar. Alternatively, type `bug 12345` directly after `ae` + Tab. Full supported Jira URL prefixes followed by numeric IDs also work.

**Chrome API limitation:** AutoEnv cannot force the address field to be replaced before you select a suggestion, or force an editable prefix to remain after Enter. Native suggestion selection allows inline editing as described above. Enter on an unfinished prefix does not navigate; there is no popup or launcher-tab workaround.

### Refresh, status and help

These commands are entered after `ae` + Tab:

| Command | Behavior |
| --- | --- |
| `refresh` + Enter | Downloads and validates both XML files, then saves them together. No page opens. |
| `status` | Shows environment count, XML source dates, bundled/downloaded state, and last refresh outcome in the default suggestion row. No Enter needed. |
| `help` | Shows syntax and command suggestions. |

After submitting `refresh`, reactivate `ae` + Tab and type `status` to see its outcome. Network requests have a 20-second timeout; lookups keep using existing data until the complete replacement is ready. `status` reports a started attempt until its result is available. Command handling is owned by [src/background.js](src/background.js).

## Catalogs and offline behavior

- [QA / PreQA XML](https://environments.orbis.dedalus.com/xml/environments.xml)
- [DEV XML](https://environments.orbis.dedalus.com/xml/environments_dev_fra.xml)

The bundled [QA / PreQA snapshot](data/environments.xml) and [DEV snapshot](data/environments_dev_fra.xml) support offline installation. Supported-region records (AU, DACHL, FR, UKI) retain their environment-type labels, including ESI, sandboxes and frozen DEV where present. Use `status` for the installed catalog's source dates and record count.

Catalog initialization uses bundled XML without a network download. Both raw XML files and parsed lookup records persist in `chrome.storage.local` across browser/service-worker restarts. Refresh is manual only; both downloads and validations must succeed before the catalog is replaced. A network, XML-validation, or storage failure preserves the previous working pair; [src/cache.js](src/cache.js) owns this replacement boundary. Company VPN/network access may be required to refresh or reach an internal endpoint. Offline lookup does not make the destination applications available offline.

## Privacy and permissions

The [manifest](manifest.json) requests only `storage` and host access to `https://environments.orbis.dedalus.com/*`; it declares no popup or content scripts. AutoEnv does not request browsing-history or notification permissions, and has no telemetry, external assets or remotely hosted executable code. Queries are resolved locally, not sent to the XML download service. Opening a destination does not bypass login, VPN, DNS, access controls or certificate validation.

The snapshots contain internal infrastructure inventory. Treat the source/build folders according to company policy; do not publish them to a public repository or extension store without authorization.

## Development

Build and test commands are owned by [package.json](package.json); [scripts/build.mjs](scripts/build.mjs) produces the unpacked `dist` folder. No HTML pages or runtime package installation are needed after building.

Source entry points: [catalog parsing](src/catalog.js), [endpoint/Jira resolution](src/resolve.js), [persistent catalogs](src/cache.js), and [omnibox integration](src/background.js).
