# rr_auto

RoseRocket automation toolkit. Automates fuel and toll charge deductions onto driver bills,
and fills in manifest hours from Motive electronic logs.

## Prerequisites

- Node.js 18+
- PostgreSQL
- RoseRocket credentials (org URL, OAuth client ID/secret, username, password)

## Setup

```sh
# 1. Install dependencies
npm install
cd client && npm install && cd ..

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 3. Create the database
createdb rr_auto

# 4. Seed tables (drivers + transponders)
npm run seed

# 5. Start the app
npm run dev       # dev mode (hot reload)
npm start         # production
```

App runs at **http://localhost:5173** (dev) or **http://localhost:3001** (production build).

## Usage

The home page lists the available tools. Each one is its own page at `/<id>`, so a page can
be bookmarked or linked to directly.

### Fuel Charge Automation — `/charges`

Deducts fuel card and toll charges from driver settlement bills.

**Process Charges**
1. Select the pay period (start + end date)
2. Upload any combination of CSV/Excel files: BVD fuel card, EZ Pass, BlueWater USD, BlueWater CAD
3. Click **Process** to preview charges — nothing is written to RoseRocket yet
4. Review per-driver charges and already-posted items
5. Click **Confirm** to post to RoseRocket

Missing files are skipped; re-running for the same pay period is safe (duplicate
descriptions are never double-posted).

**Cash advances.** A BVD row whose Prod column reads `C` is cash handed to the driver, not
fuel. It is deducted like any other row with a **$20 US admin fee per advance**, and both
ride the same daily conversion as the fuel beside them. They are not shown separately: the
whole lot lands in the driver's `BVD Fuel` line, which is how the pay clerk has always done
it by hand. The preview says how many advances and how much in fees went into that line, so
a jump in a driver's fuel deduction can be accounted for.

Advances are drawn in the States and only appear in the USD export. One found in a CAD file
is left out and flagged rather than guessed at, because there the fee would need converting
on its own while the advance would not.

**Drivers** — manage the unit ID → RoseRocket driver mapping.

**Transponders** — manage the BlueWater/Ambassador Bridge transponder → unit ID mapping.

### Local Driver Hourly — `/hours`

Fills in manifest hours from Motive electronic logs, replacing entry from paper run sheets.

1. Pick a date range and the end-time rounding
2. Click **Preview**, which writes nothing
3. Review each proposed manifest; expand **working** to see how the number was reached
4. Click any figure to type a different one. The row shows what was calculated so the
   change stays visible, and a reset arrow puts it back
5. Reject anything that looks wrong, then **Apply**

**Export** writes a CSV of exactly what is on screen, in the same order, including any
figures typed by hand and anything rejected. Excel and Google Sheets both open it directly.
The results screen has its own export covering what was written.

The manifest number in the file is a `=HYPERLINK` formula, so it opens the manifest in
RoseRocket when clicked, the same as on the sheet. Excel and Sheets evaluate that on
opening; a spreadsheet set not to evaluate formulas shows the formula text instead. Because
that evaluation is on, the difference column reads "6h 54m more" rather than leading with a
plus or minus, which a spreadsheet would otherwise try to read as a formula.

Two tabs: **Manifest Hours** for the run above, and **Driver Links**, which controls two
things per driver:

- **The switch** decides whether the tool handles that driver at all. Owner-operator
  highway drivers are not on local manifests, so switching them off keeps the preview to
  the drivers that matter. Switching a driver off and back on leaves their link intact.
- **The dropdown** pairs them with their Motive driver. Most pair automatically on name;
  the few whose names differ (nicknames, typos) are picked once there. A link cleared by
  hand stays cleared and does not snap back to the name match.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `ROSEROCKET_ORG_URL` | Your org URL, e.g. `https://cetrucking.roserocket.com` |
| `ROSEROCKET_CLIENT_ID` | OAuth client ID |
| `ROSEROCKET_CLIENT_SECRET` | OAuth client secret |
| `ROSEROCKET_USERNAME` | Login email |
| `ROSEROCKET_PASSWORD` | Login password |
| `MOTIVE_API_KEY` | Motive API key, read-only. Needs permission to read drivers and compliance logs |
| `FUEL_SYNC_CRON` | (optional) Cron for the fuel-surcharge sync. Default `0 7 * * *` (daily 07:00) |
| `FUEL_SYNC_TZ` | (optional) IANA timezone for the schedule. Default `America/Toronto` |

## Google Sheet sync

Every hour the server rebuilds a tab in a Google Sheet with one row per manifest over a
rolling window, so the team can see how often the time entered in RoseRocket departs from
what Motive says.

Both times are read fresh each run, so a manifest a dispatcher corrected by hand shows
their figure exactly like one the tool wrote. **Difference** is RoseRocket minus Motive,
with **Difference (mins)** as a plain number for sorting and averaging, and **RR vs Motive**
reading `higher`, `lower` or `same`.

Only drivers switched on in **Driver Links** appear. Switching a driver off in the tool
removes their manifests from the sheet on the next run.

| Variable | Description |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | Path to the service-account JSON key |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The key inline instead, for hosted environments |
| `HOURS_SHEET_ID` | Spreadsheet id from its URL. Sync is disabled if unset |
| `HOURS_SHEET_TAB` | Tab to write, created if missing. Default `Manifest Hours` |
| `HOURS_SYNC_DAYS` | Rolling window in days. Default `14` |
| `HOURS_SYNC_CRON` | Minutes between syncs. Default `60`. See below |
| `HOURS_SYNC_TZ` | IANA timezone, used only when a cron expression is given |
| `HOURS_SYNC_ON_START` | Sync once on startup as well. Default `true` |

The sheet must be shared with the service account's `client_email` as an **Editor**. The
key lives in `credentials/google-service-account.json` for local runs; that directory is
git-ignored. Hosted environments should use `GOOGLE_SERVICE_ACCOUNT_JSON` instead of
shipping the file.
The tab is cleared and rewritten each run, so a shrinking window leaves no stale rows and
any manual edits to that tab are overwritten. Keep notes on a different tab.

Column widths, the frozen header row and the header styling are set once, when the tab is
first created, and never touched again. Resizing a column by hand survives every later
sync. Delete the tab and let it be recreated to go back to the defaults.

### Running the sync

The schedule runs **inside the server process**. Nothing else needs setting up: keep
`npm start` running and it syncs hourly. Each run rebuilds the whole window from scratch
rather than appending, so a missed run needs no catching up and the next one is complete on
its own.

To run it by hand, for a one-off window or to check something without waiting for the hour:

```sh
npm run sync:hours -- --dry   # report what it would write, touching nothing
npm run sync:hours -- 7       # run now over a 7 day window
```

`POST /api/hours/sheet/sync` does the same over HTTP, with `{ "dryRun": true }` or
`{ "days": 7 }` in the body.

`HOURS_SYNC_CRON` accepts three forms:

| Value | Meaning |
|---|---|
| `60` | Minutes between runs, counted from server start. `60` is hourly, `30` half-hourly |
| `0 * * * *` | A five-field cron expression, for landing at a particular time of day. Uses `HOURS_SYNC_TZ` |
| `off` | No in-process schedule, for when something external drives the sync |

Anything else disables the sync with a warning rather than falling back to a guess. Below
15 minutes it still runs but logs a note, since a run sweeps every manifest for the mapped
drivers and takes around 30 seconds.

The server also syncs once on startup, because intervals are counted from boot and a
restart would otherwise leave the sheet untouched for a whole interval. Set
`HOURS_SYNC_ON_START=false` to skip that. It is worth setting under `npm run dev`, where
nodemon restarts on every file save and each restart would trigger a full sweep. Nothing
runs on startup when the schedule is `off`.

## Who the changes are attributed to

RoseRocket stamps its activity feed with the account behind the API token, so every change
this app makes is credited to whoever `ROSEROCKET_USERNAME` is. Logged in as a person, the
feed reads "Roger Gratton updated the manifest", which is indistinguishable from a real
edit made by hand.

To have it read "API updated the manifest", create a RoseRocket user whose first name is
`API`, give it a role that can edit manifests and bills, and point `ROSEROCKET_USERNAME`
and `ROSEROCKET_PASSWORD` at it. The feed uses the user's first and last name, nothing
else. This affects both tools, since they share the one login.

Tokens are cached on disk in `.token*.json` and are tied to the account that obtained them,
so changing the credentials takes effect on the next call rather than whenever the old
token expires.

## Manifest hours

The duration on a manifest is a **span**, not a sum of Motive's on-duty totals:

- **Start** — the manifest's scheduled start (`start_at`, the Start Time on the driver
  card). If the driver went on duty early, by any amount, the scheduled time stands. If he
  was late by no more than 7.5 minutes he still counts as on time, so the scheduled time
  stands. Later than that, his actual on-duty time is rounded **down** to the previous
  quarter hour, and never earlier than the scheduled time.
- **End** — his last off-duty of the day, rounded to a quarter hour. Which way is a choice
  on the Manifest Hours tab: **to the nearest 15 minutes** (the default) or **up to the
  next 15**. The start time is unaffected by it. Nearest is the default because it agrees
  with what dispatchers entered by hand on 28 of 33 checked manifests, against 16 for
  rounding up.

Breaks and waiting time stay inside the span. Aug 4 2026 for John Ferris: on duty 06:25:06
against an 06:30 start (early, so 06:30 stands), last off duty 18:49:21 (rounds up to
19:00), giving 12h 30m.

Rules applied when deciding what to write:

- Completed manifests only.
- A manifest already edited by hand is left alone. RoseRocket sets `is_custom_estimated`
  when a person edits the box, which is how we tell, and setting it on our own writes stops
  a later run from overwriting them.
- Miles are never touched. Motive measures every kilometre the truck moved that day, which
  is not the distance of the manifest.
- One manifest per driver per date is assumed. Zero, or more than one, is flagged rather
  than guessed at.
- The manifest number the driver types into Motive's shipping-docs box is compared against
  the manifest, digits only, and a disagreement is flagged. It confirms a match but is
  never used to make one, because the field is free text and drivers fill it in
  inconsistently.
- Driver pay per hour is left alone — RoseRocket recalculates it from the duration.

`POST /api/hours/preview` with `{ startDate, endDate }` returns the proposals without
writing; add `"endRounding": "up"` to switch the end rounding. `POST /api/hours/apply` with `{ jobId, approvedManifestIds }` writes them; add
`"dryRun": true` to see what it would do instead.

## Fuel surcharge automation

Every morning the server pulls the latest weekly fuel surcharge and updates the **LTL** and
**TL** `org_fuel` rates in both RoseRocket orgs (CET + CEL). It upserts by name, updating
the existing record in place or creating it if missing, so it never duplicates. A rate that
already matches is left alone, so most days it writes nothing.

Two publishers of the same schedule are read, and whichever has the newest week is used:

- [speedy.ca](https://www.speedy.ca/fuel-surcharge), a JSON feed
- [trapperstransport.com](https://trapperstransport.com/resources/resources-for-customers/fuel-surcharges/),
  a table on a page, whose LTL and FTL (Tandem) columns are the LTL and TL rates. Its third
  column, FTL (Tridem), is not used

Their numbers agree week for week; they differ only in when each posts. Reading both means
a late post from one does not hold up the rate, and either being unreachable is survivable.
A disagreement on the same week is logged rather than silently resolved.

It runs daily rather than weekly because neither source publishes on a dependable day. A
weekly run gets a single attempt at each week's rate and misses it outright when a source
is late.

TL is named per-org: `F/L FUEL` in CET, `TL` in CEL; LTL is `LTL` in both.

To run it by hand:

```sh
npm run sync:fuel             # apply to both orgs
npm run sync:fuel -- --dry    # report what it would do, writing nothing
npm run sync:fuel -- CEL      # one org only
```

It needs no database, so it works even where Postgres is unavailable. It exits non-zero if
an org fails, and `2` on a bad argument.

Over HTTP:

- `GET /api/fuel-surcharge/preview` — dry run: the latest rates and the intended per-org
  actions (updated / unchanged / would create), **without writing**.
- `POST /api/fuel-surcharge/run` — applies the rates now. Body `{ "dryRun": true }` to
  preview, `{ "onlyOrg": "CEL" }` for one org.

The schedule runs inside the server process, so the server must be running each morning.

## Exchange rate

Live USD/CAD rate is fetched from [frankfurter.app](https://www.frankfurter.app) at process time. If the fetch fails, processing is aborted — a stale rate is never silently used.

## Project structure

```
.
├── client/               # React + Vite + Tailwind frontend
│   └── src/
│       ├── App.jsx           # Header + hash routing
│       ├── router.js         # History API routing (no router library)
│       ├── features.js       # Feature registry — add a feature here
│       ├── Home.jsx          # Landing page, one card per feature
│       ├── ChargesPage.jsx   # Fuel Charge Automation (3 sub-tabs)
│       ├── ProcessTab.jsx
│       ├── DriversTab.jsx
│       ├── TranspondersTab.jsx
│       ├── HoursPage.jsx     # Local Driver Hourly (2 sub-tabs)
│       ├── HoursTab.jsx
│       ├── DriverLinksTab.jsx
│       ├── api.js
│       └── ui.jsx
├── scripts/
│   ├── seed.sql          # DB seed (drivers + transponders)
│   ├── sync-fuel-surcharge.js  # Run the fuel surcharge sync by hand
│   ├── sync-hours-sheet.js     # Run the Google Sheet sync by hand
│   └── test-parsers.js   # Parser checks; needs sample exports in input/
├── src/
│   ├── auth.js           # RoseRocket OAuth (token cache)
│   ├── driverMap.js      # RoseRocket driver ↔ Motive driver pairing
│   ├── hours.js          # The manifest hours rule (pure)
│   ├── hoursSheet.js     # Builds the Google Sheet rows and pushes them
│   ├── hoursSync.js      # Pairs manifests to Motive logs, builds the preview
│   ├── sheets.js         # Google Sheets client (service account)
│   ├── manifests.js      # master_trips: list, read, write duration
│   ├── motive.js         # Motive API (drivers, HOS logs)
│   ├── exchange.js       # Live USD/CAD rate
│   ├── parsers.js        # CSV parsers: BVD, EZ Pass, BlueWater
│   └── roserocket.js     # API calls (bills, sub-bills)
├── db.js                 # PostgreSQL pool + initDb()
├── server.js             # Express API server (port 3001)
└── .env
```

## Adding a feature

1. Build the page component under `client/src/`.
2. Add an entry to `FEATURES` in `client/src/features.js`: id, name, blurb, icon, `orgs`
   and the component. The home page card, the page header, the org badge and the route all
   follow from that entry.

`orgs` is the RoseRocket org or orgs the tool acts on, e.g. `['CET']`, `['CEL']`, or
`['CET', 'CEL']` for one covering both. It is shown as a badge beside the tool name on the
home page and on the tool's own page.

Give an entry `status: 'soon'` to list it on the home page before it is finished; the card
shows but does not open.
