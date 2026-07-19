# WRI Respond (external responder gateway — static rebuild)

Token-free static SPA replacing the staff/UI-clunky parts of the GAS
`wri-gateway`. Built 2026-07-19. **Parallel run:** the legacy Gateway stays
live and untouched until cutover.

**Live:** https://whitewaterrescue.github.io/wri-respond/
**Repo:** github.com/Whitewaterrescue/wri-respond · work clone `C:\Users\codywhitewaterrescue\wri-respond-work`
**JSON API deployment:** `AKfycbx7p4-A8F6G_VedgHsw3RDJgwJK1GKVAFcvSah1JdjIdG5g7PAcvXhHRKHk_ULIhdL0KA` (dedicated; never touch the legacy staff-facing deployment)

## Why this exists (the security fix)

The legacy Gateway handed an **org-privileged ArcGIS token** to every anonymous
responder's `localStorage` (`checkIn`/`refreshToken` returned `viewer_token`)
and injected it into every map/attachment request. Anyone who found the URL got
a working org token. It also verified the PIN/session on almost no endpoint, and
`searchUsers` leaked the whole user directory pre-auth.

This rebuild ships **no token, ever**:
- Map reads **public read-only view layers** (source layers stay private).
- All writes stay server-mediated through a **session-gated JSON API**.
- PIN verified server-side inside check-in; user autocomplete is PIN-gated;
  all data endpoints require a server-issued `session_token` (SHA-256 hash on
  the check-in row + write-through cache).

## Architecture

- **Static SPA** (no build): `index.html` + `css/app.css` (ported verbatim from
  the legacy App.html) + `js/*` modules. ArcGIS SDK is lazy-loaded (AMD) only
  when the Map tab first opens — the legacy app loaded the full SDK eagerly
  before check-in.
- **`js/config.js`** holds the public constants: API URL, the two public view
  URLs, and `GATEWAY_WEBMAP_ID` (per-incident public COP map).
- **GAS side (`../wri-gateway/Api.gs`)** — additive: `doGet ?api=` reads +
  `doPost` action envelope. Legacy `google.script.run` endpoints are byte-
  identical (parallel run). `setupRespondProps()` records the public-view URLs
  as script properties so `?api=incident` serves them too (optional; config.js
  is the SPA's source of truth).

### Map layers
- Standing public views (recon, resources) — `create_public_views.py`, run once.
  Recon view hides PII (reporter_name, affiliation_desc) and **excludes the
  Safety category**; resource view hides identity fields. Incidents are filtered
  by attribute (`project_name` / `incident_id`) so the views are reused forever.
- Per-incident COP web map — `activate_gateway_map.py <incident webmap id>`.
  Default-DENY allowlist: publishes only operational geometry (divisions,
  staging, boom, zones, closures, evacuation, TFR, impacted railcars). **Never**
  publishes emergency contacts, ERAPs, HASP, SPOT tracker, tracks, GRP/FRP asset
  caches, or the oil-plume trace. Current live map: `4dca3c1597974f6b8a037109e0e5bb63`.

## Scripts (this folder)

| Script | Purpose |
|---|---|
| `create_public_views.py [--dry-run]` | One-time: build the standing public recon/resource views |
| `activate_gateway_map.py <incident webmap id> [--dry-run]` | Per-incident: build/refresh the public COP web map; prints the id to put in `js/config.js` (or run `setupRespondProps`) |
| `register_oauth_app.py` | (n/a here — the SPA needs no OAuth app; map is tokenless) |

## Per-incident setup

1. `python activate_gateway_map.py <incident webmap item id> --dry-run` — review
   the publish/skip triage. **Always dry-run first**; it's a public-exposure
   decision. Adjust `ALLOW_PATTERNS` / `DENY_PATTERNS` if the layer set differs.
2. Run without `--dry-run` to create/refresh the public "WRI Gateway Map".
3. Put the printed id in `js/config.js` `GATEWAY_WEBMAP_ID`, commit, push
   (or set the `GATEWAY_WEBMAP_ID` script property so `?api=incident` serves it).

## Gotchas learned

- GAS POST must be `Content-Type: text/plain` (no CORS preflight) + `redirect:'follow'`; every response is HTTP 200, status is in the `{ok,error}` body.
- AGOL forbids a **view-of-a-view** — the script resolves each layer to its root source before creating a `_gwpublic` view.
- AGOL **item search lags** right after creation → reuse detection probes the REST service endpoint directly (feature views) and retries the web-map title search; a re-run soon after a create can still mint a duplicate web map — verify there's only one "WRI Gateway Map" after running.
- Keep `OBJECTID` + `GlobalID` visible on any view or attachments/popups break.
- Manifest access must be `ANYONE_ANONYMOUS` (not `ANYONE`, which requires Google login) for the API deployment.

## Verified 2026-07-19 (headless Chrome)

- Boot → PIN gate; wrong PIN rejected server-side; no token in localStorage; **zero ArcGIS token requests**; no JS errors.
- API: `?api=incident` open; `sitstat`/writes reject without a session (`auth_required`); `users` requires PIN.
- Public views: anonymous query + recon attachments work; PII fields absent; Safety recon excluded (134 of 136).
- Map: gateway web map + fallback both render satellite + recon/resource features **tokenless**, zoomed to the incident.

## NOT yet done (needs Cody)

- **Full authenticated E2E** (real PIN → check in → recon submit w/ photo → resource submit → checkout) — the PIN lives in a WRIServiceLib script property and only Cody has it. Server endpoints are unit-verified; the live write round-trip is the one manual check.
- **Cutover** (see below).

## Cutover checklist (run later, on Cody's go)

1. Full authenticated E2E on the live SPA with the real PIN.
2. Repoint the `whitewaterrescue.com/respond` QR/redirect → `https://whitewaterrescue.github.io/wri-respond/`.
3. In `wri-gateway`, strip `viewer_token` + `token_expiry` from `checkIn`'s
   return and delete `refreshToken` (or retire the legacy deployment entirely).
4. Optionally gate or retire the remaining legacy `google.script.run` endpoints.
5. Rotate the org ArcGIS token that legacy clients were issued (it was exposed
   historically).
