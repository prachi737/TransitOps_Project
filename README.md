# TransitOps — Starter Project (Node.js / Express / EJS version)

Same TransitOps app, built with plain JavaScript instead of Python. Runs
end-to-end already: login → dashboard → vehicles → drivers → trips →
maintenance → fuel/expenses → reports/CSV export, with the mandatory
business rules wired in.

**No SQL database required** — data is stored in `data/db.json` (a plain
JSON file) using a tiny library called `lowdb`. It behaves like an array of
JavaScript objects, so if you know `.filter()`, `.find()`, and `.push()`,
you already know how to work with it.

## 1. Setup (5 minutes)

```bash
# 1. Unzip the project, then inside the folder:
npm install
node server.js
```

Open http://localhost:3000 — it auto-creates `data/db.json` and seeds
4 demo logins (password for all: `password123`):

| Email | Role |
|---|---|
| manager@transitops.com | Fleet Manager |
| driver@transitops.com | Driver |
| safety@transitops.com | Safety Officer |
| finance@transitops.com | Financial Analyst |

Push this to a shared GitHub repo immediately so all 4 of you can pull it
and work in parallel branches.

## 2. What's already built

- Auth + RBAC via `express-session` (a couple of routes are role-locked as
  a demo — e.g. only Fleet Manager/Safety Officer can add vehicles/drivers)
- Dashboard KPIs (active/available vehicles, trips, drivers on duty, fleet utilization %)
- Vehicle Registry (add + list; unique registration number enforced)
- Driver Management (add + list; expired licenses highlighted in red)
- Trip Management with **all mandatory business rules**:
  - Retired/In Shop vehicles never shown for dispatch
  - Expired-license or Suspended drivers never shown for dispatch
  - Cargo weight validated against vehicle max load
  - Dispatch → both vehicle & driver become "On Trip"
  - Complete → both become "Available" again, fuel log auto-created
  - Cancel → restores Available
- Maintenance workflow (create → vehicle "In Shop"; close → vehicle "Available")
- Fuel logs + other Expenses
- Reports: Fuel Efficiency, Operational Cost, ROI, Fleet Utilization + CSV export

## 3. Project structure

```
transitops-js/
├── server.js          # all routes + business logic (the main file)
├── db.js              # sets up the JSON "database" + seed data
├── data/db.json        # auto-created on first run, holds all your data
├── views/              # EJS templates (like HTML with <% %> for logic)
│   ├── partials/header.ejs, footer.ejs   # navbar + page wrapper
│   ├── login.ejs, dashboard.ejs, vehicles.ejs, drivers.ejs,
│   │   trips.ejs, maintenance.ejs, fuel_expenses.ejs, reports.ejs
└── package.json
```

If you've written HTML before, EJS will feel familiar: `<%= value %>` prints
a value, `<% if (...) { %> ... <% } %>` is a normal if-statement, just inside
the HTML.

## 4. Suggested 4-person split (parallel work, minimal file conflicts)

**Person A — Auth, Dashboard & Polish**
- Improve RBAC (hide nav links a user's role can't use, not just block the route)
- Add dashboard filters (vehicle type / status / region)
- Overall visual polish, favicon, loading states
- Own files: `views/dashboard.ejs`, `views/partials/*`, `server.js` (auth section only)

**Person B — Vehicles & Drivers**
- Add Edit/Retire buttons for vehicles (currently only Add + List)
- Add Suspend/Reinstate for drivers
- Add search/sort/filter on both tables (bonus feature)
- Own files: `views/vehicles.ejs`, `views/drivers.ejs`, `server.js` (vehicle/driver routes)

**Person C — Trips & Maintenance**
- Test every business rule from the "Example Workflow" in the brief step by step
- Add better validation error messages
- Add an email-reminder stub for expiring licenses (bonus — can just `console.log`)
- Own files: `views/trips.ejs`, `views/maintenance.ejs`, `server.js` (trip/maintenance routes)

**Person D — Fuel/Expenses, Reports & Analytics**
- Add a chart (Chart.js via CDN, no build step) for fleet utilization or cost breakdown
- Double-check ROI/fuel-efficiency formulas match the brief
- Try adding PDF export (bonus — CSV already works) with a library like `pdfkit`
- Own files: `views/fuel_expenses.ejs`, `views/reports.ejs`, `server.js` (reports section)

Everyone touches `server.js` and `db.js`, so **commit and pull often** —
routes are additive, so merge conflicts should be small if each person stays
in their section.

## 5. Suggested 8-hour timeline

| Time | Milestone |
|---|---|
| 0:00–0:30 | Everyone: clone repo, `npm install`, run app locally, agree on git branches |
| 0:30–3:00 | Build in parallel per the split above |
| 3:00–3:30 | Merge everyone's branches into `main`, fix conflicts |
| 3:30–5:30 | Continue features + bonus items |
| 5:30–6:30 | Full run-through of the "Example Workflow" from the brief as a team, fix bugs |
| 6:30–7:15 | Polish UI, add validations, seed a few demo records |
| 7:15–8:00 | Prepare demo script + slides, rehearse who presents which module |

## 6. Notes / things to double check against the brief

- The brief's ROI formula needs a "Revenue" figure, which the raw brief
  doesn't define a source for — this starter adds an optional `revenue`
  field when completing a trip so ROI can be computed. Decide as a team if
  you want revenue to come from somewhere else (e.g. a per-km rate).
- "Region" isn't in the current Vehicle model — add a `region` field if you
  want the dashboard region filter (bonus feature) to be meaningful.
- `data/db.json` is a single shared file — if you run the app on multiple
  laptops at once you'll get separate local datasets. For the live demo,
  run the final app from **one laptop** so everyone sees the same data.
- Dark mode, document management, and email reminders are bonus features
  not yet implemented — tackle only if core requirements are solid and demoed first.
