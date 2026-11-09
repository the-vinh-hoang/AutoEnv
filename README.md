# AutoEnv

Chrome's omni search for ORBIS environment endpoints and Dedalus Jira tickets. 



## Address-bar usage

Type **`ae`**, press **Tab** (or Space), then type a query. This uses Chrome's built-in keyword/site-search interaction, like typing `google.com` then Tab. Chrome requires the activation keyword; the extension does not intercept unrelated address-bar input.

```text
qouk4442 iris
iris qouk4442
QOAT4442 webstart
dod0804f fhir
fhir-back-end dod0804f
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
| `fhir` | `OAS - APP - application:fhir` | 9993 | `/console/index.html` |
| `fhir-back-end` | `OAS - APP - application:fhir-back-end` | 9993 | `/console/index.html` |

ORBIS PROXY products are discovered separately for each proxy host listed under the exact `ORBIS PROXY` XML software entry. AutoEnv fetches `https://<host>/u/proxy/v2/routes`: `component` is the searchable product name, `proxy-location` is the exact path (including any trailing slash), and `proxy-port` is the HTTPS port (443 is implicit; other ports are explicit). There is no fixed proxy product list or fallback to guessed paths. Entries without a usable component, path or port are skipped; duplicate URLs merge, while multiple paths/ports for one component remain separate choices.

For example, `poch4446 iris-tracing` resolves to `https://POCH4446-U.ORBIS.DEDALUS.COM/u/iris-tracing/` when its collector reports `component: "iris-tracing"`, `proxy-location: "/u/iris-tracing/"`, and `proxy-port: "443"`. Products such as `grafana` or `erp-4u` become available without changing the extension. A database-only query lists discovered products alongside the fixed endpoints above. Exact product names win over prefixes; without a discovered `u`, `u` may prefix-complete to the fixed `ucc` product instead. Check the displayed URL before Enter.

Chrome may lowercase hostnames because DNS is case-insensitive. Software names must match exactly: some DEV entries have an OAS application-server entry but lack `OAS - CON - standard:single`, so they have no OAS/webstart/UCC result. Hosts are not substituted from another software entry. Software-name rules live in [src/catalog.js](src/catalog.js), route discovery/cache in [src/routes.js](src/routes.js), and endpoint/Jira resolution in [src/resolve.js](src/resolve.js).

### Jira

| Shortcut / aliases | Fixed URL prefix |
| --- | --- |
| `bug`, `orbisbug`, `defect` | `https://dedalus.atlassian.net/browse/ORBISBUG-` |
| `hconn`, `story` | `https://dedalus.atlassian.net/browse/HCONN-` |
| `hepic`, `epic` | `https://dedalus.atlassian.net/browse/HEPIC-` |

A bare alias shows its URL prefix in the suggestion list. To fill the prefix first, type **`ae` → Tab → `bug` → Down arrow → End → ticket digits → Enter**. Down arrow selects the prefix suggestion and fills the address field with `https://dedalus.atlassian.net/browse/ORBISBUG-`; End places the cursor after the hyphen so you can append the ticket number entirely in the address bar. Alternatively, type `bug 12345` directly after `ae` + Tab. Full supported Jira URL prefixes followed by numeric IDs also work.

**Chrome API limitation:** AutoEnv cannot force the address field to be replaced before you select a suggestion, or force an editable prefix to remain after Enter. Native suggestion selection allows inline editing as described above. Enter on an unfinished prefix does not navigate; there is no popup or launcher-tab workaround.

### Update, status and help

These commands are entered after `ae` + Tab:

| Command | Behavior |
| --- | --- |
| `update` + Enter | Downloads and validates both XML files, then collects products from every known ORBIS PROXY. Replaces the former `refresh` command. No page opens. |
| `status` | Shows environment count, XML source dates, bundled/downloaded state, proxy route cache coverage/unavailable hosts, and last update outcome in the default suggestion row. No Enter needed. |
| `help` | Shows syntax and command suggestions. |

`update` is the first suggestion when `ae` + Tab has no search text; Enter on the empty query also runs it. Updates also start automatically on installation, extension reload/update, and browser startup, but not on every service-worker wake. After an update, reactivate `ae` + Tab and type `status` to see the result. XML downloads time out after 20 seconds; each route collector after 10 seconds, with at most 16 collectors in flight. A full update may take a few minutes on a partially unavailable network. Lookups continue using saved data while collection runs. The status shows `started` during a run, `partial` for unreachable collectors, or `interrupted` if the worker stopped before recording a result. Command handling is owned by [src/background.js](src/background.js).

### Collectors with saved certificate exceptions

A collector may load after you approve its certificate warning in a tab while the extension's service-worker request still fails; this is a [Chromium Manifest V3 limitation](https://issues.chromium.org/issues/40882068). AutoEnv's [collector transport](src/background.js) can instead read the JSON already displayed in an open tab for that exact collector URL.

1. Reload the updated unpacked `dist` extension in `edge://extensions` (or `chrome://extensions`) and approve the new `scripting` permission if prompted.
2. Open the collector in the **same browser and profile as AutoEnv**, for example `https://qouk0804-proxy.orbis.dedalus.com/u/proxy/v2/routes`. Only approve a certificate warning if your company has verified that endpoint and certificate.
3. Wait until the JSON is visible and leave the tab open. Reload the collector page first when you need current routes: the fallback reads the displayed document, not a fresh download.
4. Enter `ae`, press Tab or Space, type `update`, then press Enter. Reactivate `ae` and type `status` to check the update; other unavailable hosts may still make the overall result partial.
5. Reactivate `ae` and type `qouk0804 pas` to check the PAS suggestion. Once collected, routes remain cached after the collector tab closes.

AutoEnv does not open collector tabs, approve warnings, or disable certificate validation. For unattended collection without an open collector tab, ask your IT team to establish trust in the issuing CA or fix the proxy's certificate.

## Build

Build with Node.js 22+; run with Chrome 120+ (requirements: [package.json](package.json) and [manifest.json](manifest.json)).

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and choose **`dist`** (not the repository root). After changing source, rebuild and click Reload on the extension card. Teammates can load a copy of the complete built `dist` folder without Node.js.

# Install
Install the unpacked extension in dist/ into Chrome.

## Catalogs and offline behavior

- [QA / PreQA XML](https://environments.orbis.dedalus.com/xml/environments.xml)
- [DEV XML](https://environments.orbis.dedalus.com/xml/environments_dev_fra.xml)

The bundled [QA / PreQA snapshot](data/environments.xml) and [DEV snapshot](data/environments_dev_fra.xml) support offline installation. Supported-region records (AU, DACHL, FR, UKI) retain their environment-type labels, including ESI, sandboxes and frozen DEV where present. Use `status` for the installed catalog's source dates and record count.

Catalog initialization loads bundled XML when no valid saved catalog exists. Both raw XML files and parsed lookup records persist in `chrome.storage.local` across browser/service-worker restarts. Automatic and manual updates replace the XML catalog only after both downloads and validations succeed; download, validation or storage failures preserve the previous working pair. If a catalog download fails, route discovery still runs against the saved/bundled inventory. [src/cache.js](src/cache.js) owns the XML replacement boundary.

Proxy routes are stored separately per lowercase hostname, with the last successful collection time and any current collection error. Each successful response replaces that host's routes, including removing products no longer reported (an empty array clears them). Failed collectors retain their last successful routes; one failed host does not discard other hosts' discoveries. A failed route-cache storage write preserves the previous route snapshot. Only component/path/port data is stored, not raw upstream configuration. On a first offline installation, fixed OAS/FHIR lookups work, but proxy products require one successful collection before they are available offline. Company VPN/network access may be required to update or reach internal endpoints; offline lookup does not make destination applications available offline.

Older XML indexes are rebuilt from their saved XML to enable the FHIR console options without losing the installed catalog or its dates. If an exact FHIR application entry is missing, its fixed option produces no result; proxy components are independent discoveries, not substitutes for missing application hosts.

## Privacy and permissions

The [manifest](manifest.json) requests `storage`, `scripting`, and HTTPS host access to `*.orbis.dedalus.com` (including the XML catalog service) and `*.dedalus.lan` for proxy collectors. Chrome or Edge may ask you to approve changed permissions after upgrading. Network requests omit credentials, reject redirects, and use only catalog-listed proxy hosts. The certificate-exception fallback uses a read-only, isolated script in the main frame of an already-open exact collector URL; it does not inspect unrelated tabs. AutoEnv declares no popup or persistent content scripts and requests no browsing-history or notification permissions. There is no telemetry, external asset loading or remotely hosted executable code. Queries are resolved locally and are not sent to collectors or the XML service. Opening a destination does not bypass login, VPN, DNS, access controls or certificate validation.

The snapshots contain internal infrastructure inventory. Treat the source/build folders according to company policy; do not publish them to a public repository or extension store without authorization.

## Development

Build and test commands are owned by [package.json](package.json); [scripts/build.mjs](scripts/build.mjs) produces the unpacked `dist` folder. No HTML pages or runtime package installation are needed after building.

Source entry points: [catalog parsing](src/catalog.js), [endpoint/Jira resolution](src/resolve.js), [persistent XML catalogs](src/cache.js), [per-host proxy routes](src/routes.js), and [omnibox integration](src/background.js).

### GitHub builds

The [build workflow](.github/workflows/build.yml) owns automated checks and extension packaging. After pushing it to GitHub, open the repository's **Actions** tab, select a successful **Build extension** run, and download **autoenv-extension** from **Artifacts**. Extract the archive and load the folder containing `manifest.json` through Chrome's **Load unpacked** control. Downloading artifacts requires a GitHub login and access to the repository.

Build artifacts contain the bundled internal catalogs, so the [privacy guidance](#privacy-and-permissions) also applies to their distribution.
