# TransitOps — Node.js / Express / EJS / MySQL

Same TransitOps app, now backed by **MySQL** instead of the `lowdb`
JSON file, so it can run against a real shared database server, handle
concurrent users safely, and scale past what a single JSON file could
reasonably support.

## 1. What changed from the lowdb version

- **Storage**: `data/db.json` → MySQL tables (`schema.sql`), one table
  per collection (`users`, `vehicles`, `drivers`, `trips`,
  `maintenance_logs`, `fuel_logs`, `expenses`), with foreign keys and
  indexes on every column the app filters or joins on
  (`status`, `vehicle_id`, `driver_id`, `license_expiry`, etc).
- **Connections**: `db.js` now opens a `mysql2` **connection pool**
  (default 10 connections, configurable via `DB_POOL_SIZE`) instead of
  reading/writing one file. Each request borrows a connection and
  returns it, so many requests can hit the database at once without
  serializing on file I/O.
- **Concurrency safety**: the multi-step business rules (dispatch,
  complete, cancel a trip; open/close maintenance) now run inside real
  SQL transactions with `SELECT ... FOR UPDATE` row locks. In the old
  version, two people clicking "Dispatch" on the same vehicle at the
  same moment could both succeed. Now the second one waits for the
  first transaction to commit and then correctly sees the vehicle as
  already `On Trip`.
- **Uniqueness**: registration numbers, license numbers, and emails are
  enforced with MySQL `UNIQUE` constraints rather than a
  check-then-insert in JS, closing the same kind of race condition.
- **Reports**: fuel efficiency / operational cost / revenue / ROI are
  computed with SQL `SUM()`/`GROUP BY` aggregation instead of loading
  every trip, fuel log, maintenance log, and expense into Node and
  reducing over them — so report cost grows with query complexity, not
  with how much historical data has piled up.
- **IDs**: MySQL `AUTO_INCREMENT` replaces the hand-rolled `nextId()`
  counters.

Business logic and rules are unchanged: retired/in-shop vehicles never
show for dispatch, expired-license/suspended drivers never show for
dispatch, cargo weight is checked against max load, dispatch/complete/
cancel/maintenance flip status the same way, and the same fields flow
into the EJS views.

> **Note**: only `server.js`, `db.js`, `package.json`, and this README
> were regenerated here — the `views/*.ejs` templates from your project
> weren't part of this upload, so they're untouched. The data shapes
> passed into `res.render(...)` were kept identical (same field names:
> `regNumber`, `licenseExpiry`, `trip.vehicle.regNumber`, etc.) so your
> existing templates should keep working without changes.

## 2. Setup

### Install MySQL

Any MySQL 8+ (or MariaDB 10.5+) server works — local install, Docker,
or a managed service (PlanetScale, RDS, Cloud SQL, etc).

```bash
# Docker option:
docker run --name transitops-mysql -e MYSQL_ROOT_PASSWORD=yourpassword -p 3306:3306 -d mysql:8
```

### Create the schema

```bash
mysql -u root -p < schema.sql
```

This creates the `transitops` database and all tables, with indexes
and foreign keys already in place.

### Configure the app

```bash
cp .env.example .env
# edit .env with your DB_HOST / DB_USER / DB_PASSWORD
```

### Install and run

```bash
npm install
node server.js
```

Open http://localhost:3000 — on first run it seeds 4 demo logins
(password for all: `password123`):

| Email | Role |
|---|---|
| manager@transitops.com | Fleet Manager |
| driver@transitops.com | Driver |
| safety@transitops.com | Safety Officer |
| finance@transitops.com | Financial Analyst |

## 3. Project structure

```
transitops-js/
├── schema.sql          # MySQL DDL: tables, indexes, foreign keys
├── server.js           # all routes + business logic
├── db.js               # MySQL pool, query/transaction helpers, seed data
├── .env.example         # copy to .env and fill in DB credentials
├── views/               # EJS templates (unchanged — bring your own from the original project)
└── package.json
```

## 4. Scaling this further

The current setup is enough for a small team demo running one Node
process against one MySQL instance. If you outgrow that:

- **Multiple app instances**: this app is already stateless-per-request
  except for `express-session`, which defaults to in-memory storage —
  that only works with a single process. Before running more than one
  Node instance (or a load balancer), swap in a shared session store
  (`connect-redis` or `express-mysql-session`) so logins survive across
  instances.
- **Read load**: if reporting/dashboard reads start competing with
  write traffic, point read-heavy routes at a MySQL read replica.
- **Pool sizing**: `DB_POOL_SIZE` in `.env` controls how many
  connections each Node process opens. Size it against your MySQL
  server's `max_connections` divided by the number of app instances
  you run.
- **Query patterns**: everything already goes through parameterized
  queries (no string-built SQL) and the indexes in `schema.sql` cover
  every `WHERE`/`JOIN` column currently used — if you add new filters
  or reports, add matching indexes.

## 5. Notes / things to double check against the brief

- The brief's ROI formula needs a "Revenue" figure — this app records
  an optional `revenue` value when a trip is completed so ROI can be
  computed. Decide as a team if you'd rather source revenue elsewhere
  (e.g. a per-km rate).
- `vehicles.region` exists as a column if you want the dashboard region
  filter (bonus feature) to be meaningful — it's not populated by the
  current forms.
- Dark mode, document management, and email reminders are bonus
  features not yet implemented.
