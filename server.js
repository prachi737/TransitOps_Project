// server.js
require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const { query, withTransaction, seed, assertConnection } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-this-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// Wraps an async route handler so a thrown/rejected error reaches Express's
// error middleware instead of crashing the process or hanging the request.
const asyncRoute = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// ---------------------------------------------------------------
// AUTH HELPERS
// ---------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect("/login");
  res.locals.currentUser = req.session.user; // available in every EJS view
  next();
}

// Usage: requireRole("fleet_manager", "safety_officer")
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.session.user.role)) {
      req.session.flash = { type: "danger", msg: "You don't have permission to do that." };
      return res.redirect("/dashboard");
    }
    next();
  };
}

// Pull a one-time flash message into every view, then clear it
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  req.session.flash = null;
  next();
});

function setFlash(req, type, msg) {
  req.session.flash = { type, msg };
}

const DUPLICATE_ENTRY = "ER_DUP_ENTRY";

// ---------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------
app.get("/", (req, res) => res.redirect("/dashboard"));

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("login");
});

app.post(
  "/login",
  asyncRoute(async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const { password } = req.body;

    const rows = await query(
      "SELECT id, email, name, role, password_hash AS passwordHash FROM users WHERE email = ?",
      [email]
    );
    const user = rows[0];

    if (user && bcrypt.compareSync(password, user.passwordHash)) {
      req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email };
      return res.redirect("/dashboard");
    }
    setFlash(req, "danger", "Invalid email or password.");
    res.redirect("/login");
  })
);

app.get("/signup", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("signup");
});

app.post(
  "/signup",
  asyncRoute(async (req, res) => {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const role = req.body.role || "driver";
    const allowedRoles = ["fleet_manager", "driver", "safety_officer", "financial_analyst"];

    if (!name || !email || password.length < 6 || !allowedRoles.includes(role)) {
      setFlash(req, "danger", "Please enter a valid name, email, role, and a password with at least 6 characters.");
      return res.redirect("/signup");
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    try {
      // Rely on the UNIQUE constraint on email rather than a separate
      // check-then-insert, so two concurrent signups for the same
      // address can't both succeed (a real race under load).
      const result = await query(
        "INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)",
        [email, name, role, passwordHash]
      );
      req.session.user = { id: result.insertId, name, role, email };
      res.redirect("/dashboard");
    } catch (err) {
      if (err.code === DUPLICATE_ENTRY) {
        setFlash(req, "danger", "An account with that email already exists.");
        return res.redirect("/signup");
      }
      throw err;
    }
  })
);

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ---------------------------------------------------------------
// DASHBOARD
// Uses aggregate SQL (COUNT/SUM) instead of loading every row into
// Node, so KPI cost stays flat as the fleet grows.
// ---------------------------------------------------------------
app.get(
  "/dashboard",
  requireLogin,
  asyncRoute(async (req, res) => {
    // ---- filters from the querystring (?type=&status=&region=) ----
    const selectedType = (req.query.type || "").trim();
    const selectedStatus = (req.query.status || "").trim();
    const selectedRegion = (req.query.region || "").trim();

    const whereClauses = [];
    const whereParams = [];
    if (selectedType) {
      whereClauses.push("type = ?");
      whereParams.push(selectedType);
    }
    if (selectedStatus) {
      whereClauses.push("status = ?");
      whereParams.push(selectedStatus);
    }
    if (selectedRegion) {
      whereClauses.push("region = ?");
      whereParams.push(selectedRegion);
    }
    const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : "";

    // ---- vehicle KPIs + chart data, scoped to the current filters ----
    const [vehicleStats] = await query(
      `
      SELECT
        SUM(status != 'Retired') AS activeVehicles,
        SUM(status = 'Available') AS availableVehicles,
        SUM(status = 'In Shop') AS inMaintenance,
        SUM(status = 'On Trip') AS onTripVehicles,
        SUM(status = 'Retired') AS retiredVehicles
      FROM vehicles
      ${whereSql}
      `,
      whereParams
    );

    // ---- trip / driver KPIs (not vehicle-filtered — no type/region concept there) ----
    const [tripStats] = await query(`
      SELECT
        SUM(status = 'Dispatched') AS activeTrips,
        SUM(status = 'Draft') AS pendingTrips
      FROM trips
    `);
    const [driverStats] = await query(`
      SELECT SUM(status = 'On Trip') AS driversOnDuty FROM drivers
    `);

    const activeVehicles = Number(vehicleStats.activeVehicles) || 0;
    const onTripVehicles = Number(vehicleStats.onTripVehicles) || 0;
    const fleetUtilization = activeVehicles
      ? Math.round((onTripVehicles / activeVehicles) * 1000) / 10
      : 0;

    // ---- distinct filter options for the dropdowns ----
    const typeRows = await query("SELECT DISTINCT type FROM vehicles WHERE type IS NOT NULL ORDER BY type");
    const regionRows = await query(
      "SELECT DISTINCT region FROM vehicles WHERE region IS NOT NULL AND region != '' ORDER BY region"
    );

    const filters = {
      types: typeRows.map((r) => r.type),
      regions: regionRows.map((r) => r.region),
      statuses: ["Available", "On Trip", "In Shop", "Retired"],
      selectedType,
      selectedStatus,
      selectedRegion,
    };

    // ---- doughnut chart: fleet status breakdown, same filters applied ----
    const chartData = {
      labels: ["Available", "On Trip", "In Shop", "Retired"],
      values: [
        Number(vehicleStats.availableVehicles) || 0,
        onTripVehicles,
        Number(vehicleStats.inMaintenance) || 0,
        Number(vehicleStats.retiredVehicles) || 0,
      ],
    };

    // ---- attention required: expiring licenses + vehicles stuck in shop ----
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const soonStr = soon.toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const expiringDrivers = await query(
      `SELECT id, name, license_expiry AS licenseExpiry FROM drivers
       WHERE status != 'Suspended' AND license_expiry BETWEEN ? AND ?
       ORDER BY license_expiry ASC LIMIT 5`,
      [today, soonStr]
    );
    const inShopVehicles = await query(
      `SELECT id, reg_number AS regNumber, name FROM vehicles WHERE status = 'In Shop' LIMIT 5`
    );

    const attentionItems = [
      ...expiringDrivers.map((d) => ({
        href: "/drivers",
        level: "warning",
        icon: "bi-person-badge",
        title: `${d.name}'s license expires soon`,
        detail: `Expires ${d.licenseExpiry}`,
      })),
      ...inShopVehicles.map((v) => ({
        href: "/maintenance",
        level: "info",
        icon: "bi-tools",
        title: `${v.regNumber} is in the shop`,
        detail: v.name,
      })),
    ];

    res.render("dashboard", {
      kpis: {
        activeVehicles,
        availableVehicles: Number(vehicleStats.availableVehicles) || 0,
        inMaintenance: Number(vehicleStats.inMaintenance) || 0,
        activeTrips: Number(tripStats.activeTrips) || 0,
        pendingTrips: Number(tripStats.pendingTrips) || 0,
        driversOnDuty: Number(driverStats.driversOnDuty) || 0,
        fleetUtilization,
      },
      filters,
      chartData,
      attentionItems,
    });
  })
);

// ---------------------------------------------------------------
// VEHICLE REGISTRY
// ---------------------------------------------------------------
app.get(
  "/vehicles",
  requireLogin,
  asyncRoute(async (req, res) => {
    const vehicles = await query(`
      SELECT id, reg_number AS regNumber, name, type,
             max_load AS maxLoad, odometer, acquisition_cost AS acquisitionCost,
             status, region
      FROM vehicles
      ORDER BY id DESC
    `);
    res.render("vehicles", { vehicles });
  })
);

app.post(
  "/vehicles/add",
  requireLogin,
  requireRole("fleet_manager"),
  asyncRoute(async (req, res) => {
    const { regNumber, name, type, maxLoad, odometer, acquisitionCost } = req.body;

    try {
      await query(
        `INSERT INTO vehicles (reg_number, name, type, max_load, odometer, acquisition_cost, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Available')`,
        [regNumber, name, type, parseFloat(maxLoad), parseFloat(odometer) || 0, parseFloat(acquisitionCost) || 0]
      );
      setFlash(req, "success", "Vehicle registered.");
    } catch (err) {
      if (err.code === DUPLICATE_ENTRY) {
        setFlash(req, "danger", "Registration number must be unique.");
      } else {
        throw err;
      }
    }
    res.redirect("/vehicles");
  })
);

// ---------------------------------------------------------------
// DRIVER MANAGEMENT
// ---------------------------------------------------------------
app.get(
  "/drivers",
  requireLogin,
  asyncRoute(async (req, res) => {
    const drivers = await query(`
      SELECT id, name, license_number AS licenseNumber, license_category AS licenseCategory,
             license_expiry AS licenseExpiry, contact_number AS contactNumber,
             safety_score AS safetyScore, status
      FROM drivers
      ORDER BY id DESC
    `);
    res.render("drivers", { drivers, today: new Date().toISOString().slice(0, 10) });
  })
);

app.post(
  "/drivers/add",
  requireLogin,
  requireRole("fleet_manager", "safety_officer"),
  asyncRoute(async (req, res) => {
    const { name, licenseNumber, licenseCategory, licenseExpiry, contactNumber, safetyScore } = req.body;

    try {
      await query(
        `INSERT INTO drivers (name, license_number, license_category, license_expiry, contact_number, safety_score, status)
         VALUES (?, ?, ?, ?, ?, ?, 'Available')`,
        [name, licenseNumber, licenseCategory, licenseExpiry, contactNumber, parseInt(safetyScore) || 100]
      );
      setFlash(req, "success", "Driver added.");
    } catch (err) {
      if (err.code === DUPLICATE_ENTRY) {
        setFlash(req, "danger", "License number must be unique.");
      } else {
        throw err;
      }
    }
    res.redirect("/drivers");
  })
);

// ---------------------------------------------------------------
// TRIP MANAGEMENT (business rules live here)
// ---------------------------------------------------------------
app.get(
  "/trips",
  requireLogin,
  asyncRoute(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);

    const tripRows = await query(`
      SELECT
        t.id, t.source, t.destination, t.cargo_weight AS cargoWeight,
        t.planned_distance AS plannedDistance, t.status,
        t.final_odometer AS finalOdometer, t.fuel_consumed AS fuelConsumed,
        t.revenue, t.created_at AS createdAt,
        v.id AS vehicleId, v.reg_number AS vehicleRegNumber, v.name AS vehicleName,
        d.id AS driverId, d.name AS driverName, d.license_number AS driverLicenseNumber
      FROM trips t
      JOIN vehicles v ON v.id = t.vehicle_id
      JOIN drivers d ON d.id = t.driver_id
      ORDER BY t.id DESC
    `);

    const trips = tripRows.map((t) => ({
      id: t.id,
      source: t.source,
      destination: t.destination,
      cargoWeight: t.cargoWeight,
      plannedDistance: t.plannedDistance,
      status: t.status,
      finalOdometer: t.finalOdometer,
      fuelConsumed: t.fuelConsumed,
      revenue: t.revenue,
      createdAt: t.createdAt,
      vehicleId: t.vehicleId,
      driverId: t.driverId,
      vehicle: { id: t.vehicleId, regNumber: t.vehicleRegNumber, name: t.vehicleName },
      driver: { id: t.driverId, name: t.driverName, licenseNumber: t.driverLicenseNumber },
    }));

    const eligibleVehicles = await query(
      `SELECT id, reg_number AS regNumber, name, type, max_load AS maxLoad
       FROM vehicles WHERE status = 'Available'`
    );
    const eligibleDrivers = await query(
      `SELECT id, name, license_number AS licenseNumber, license_expiry AS licenseExpiry
       FROM drivers WHERE status = 'Available' AND license_expiry >= ?`,
      [today]
    );

    res.render("trips", { trips, vehicles: eligibleVehicles, drivers: eligibleDrivers });
  })
);

app.post(
  "/trips/create",
  requireLogin,
  asyncRoute(async (req, res) => {
    const { source, destination, vehicleId, driverId, cargoWeight, plannedDistance } = req.body;
    const today = new Date().toISOString().slice(0, 10);
    const cargo = parseFloat(cargoWeight);

    try {
      await withTransaction(async (conn) => {
        // FOR UPDATE locks these rows for the life of the transaction, so a
        // second concurrent dispatch attempt against the same vehicle/driver
        // has to wait rather than racing past this check.
        const [[vehicle]] = await conn.query("SELECT * FROM vehicles WHERE id = ? FOR UPDATE", [
          parseInt(vehicleId),
        ]);
        const [[driver]] = await conn.query("SELECT * FROM drivers WHERE id = ? FOR UPDATE", [
          parseInt(driverId),
        ]);

        if (!vehicle || vehicle.status !== "Available") {
          throw { businessError: "Vehicle is not available for dispatch." };
        }
        if (!driver || driver.status !== "Available" || driver.license_expiry < today) {
          throw { businessError: "Driver is not eligible (expired license or unavailable)." };
        }
        if (cargo > vehicle.max_load) {
          throw { businessError: `Cargo weight (${cargo}kg) exceeds vehicle capacity (${vehicle.max_load}kg).` };
        }

        await conn.query(
          `INSERT INTO trips (source, destination, vehicle_id, driver_id, cargo_weight, planned_distance, status)
           VALUES (?, ?, ?, ?, ?, ?, 'Draft')`,
          [source, destination, vehicle.id, driver.id, cargo, parseFloat(plannedDistance)]
        );
      });
      setFlash(req, "success", "Trip created as Draft.");
    } catch (err) {
      if (err.businessError) {
        setFlash(req, "danger", err.businessError);
      } else {
        throw err;
      }
    }
    res.redirect("/trips");
  })
);

app.post(
  "/trips/:id/dispatch",
  requireLogin,
  asyncRoute(async (req, res) => {
    const tripId = parseInt(req.params.id);

    try {
      await withTransaction(async (conn) => {
        const [[trip]] = await conn.query("SELECT * FROM trips WHERE id = ? FOR UPDATE", [tripId]);
        if (!trip || trip.status !== "Draft") {
          throw { businessError: "Only Draft trips can be dispatched." };
        }

        await conn.query("UPDATE trips SET status = 'Dispatched' WHERE id = ?", [tripId]);
        await conn.query("UPDATE vehicles SET status = 'On Trip' WHERE id = ?", [trip.vehicle_id]);
        await conn.query("UPDATE drivers SET status = 'On Trip' WHERE id = ?", [trip.driver_id]);
      });
      setFlash(req, "success", "Trip dispatched.");
    } catch (err) {
      if (err.businessError) {
        setFlash(req, "danger", err.businessError);
      } else {
        throw err;
      }
    }
    res.redirect("/trips");
  })
);

app.post(
  "/trips/:id/complete",
  requireLogin,
  asyncRoute(async (req, res) => {
    const tripId = parseInt(req.params.id);
    const finalOdometer = parseFloat(req.body.finalOdometer);
    const fuelConsumed = parseFloat(req.body.fuelConsumed);
    const revenue = parseFloat(req.body.revenue) || 0;

    try {
      await withTransaction(async (conn) => {
        const [[trip]] = await conn.query("SELECT * FROM trips WHERE id = ? FOR UPDATE", [tripId]);
        if (!trip || trip.status !== "Dispatched") {
          throw { businessError: "Only Dispatched trips can be completed." };
        }

        await conn.query(
          "UPDATE trips SET status = 'Completed', final_odometer = ?, fuel_consumed = ?, revenue = ? WHERE id = ?",
          [finalOdometer, fuelConsumed, revenue, tripId]
        );
        await conn.query("UPDATE vehicles SET status = 'Available', odometer = ? WHERE id = ?", [
          finalOdometer,
          trip.vehicle_id,
        ]);
        await conn.query("UPDATE drivers SET status = 'Available' WHERE id = ?", [trip.driver_id]);

        // Auto-log the fuel used, so Reports picks it up (placeholder rate)
        await conn.query(
          "INSERT INTO fuel_logs (vehicle_id, liters, cost, date) VALUES (?, ?, ?, ?)",
          [trip.vehicle_id, fuelConsumed, fuelConsumed * 100, new Date().toISOString().slice(0, 10)]
        );
      });
      setFlash(req, "success", "Trip completed.");
    } catch (err) {
      if (err.businessError) {
        setFlash(req, "danger", err.businessError);
      } else {
        throw err;
      }
    }
    res.redirect("/trips");
  })
);

app.post(
  "/trips/:id/cancel",
  requireLogin,
  asyncRoute(async (req, res) => {
    const tripId = parseInt(req.params.id);

    try {
      await withTransaction(async (conn) => {
        const [[trip]] = await conn.query("SELECT * FROM trips WHERE id = ? FOR UPDATE", [tripId]);
        if (!trip || !["Draft", "Dispatched"].includes(trip.status)) {
          throw { businessError: "This trip can no longer be cancelled." };
        }

        if (trip.status === "Dispatched") {
          await conn.query("UPDATE vehicles SET status = 'Available' WHERE id = ?", [trip.vehicle_id]);
          await conn.query("UPDATE drivers SET status = 'Available' WHERE id = ?", [trip.driver_id]);
        }
        await conn.query("UPDATE trips SET status = 'Cancelled' WHERE id = ?", [tripId]);
      });
      setFlash(req, "success", "Trip cancelled.");
    } catch (err) {
      if (err.businessError) {
        setFlash(req, "danger", err.businessError);
      } else {
        throw err;
      }
    }
    res.redirect("/trips");
  })
);

// ---------------------------------------------------------------
// MAINTENANCE
// ---------------------------------------------------------------
app.get(
  "/maintenance",
  requireLogin,
  asyncRoute(async (req, res) => {
    const logRows = await query(`
      SELECT m.id, m.description, m.cost, m.date, m.status,
             v.id AS vehicleId, v.reg_number AS vehicleRegNumber, v.name AS vehicleName
      FROM maintenance_logs m
      JOIN vehicles v ON v.id = m.vehicle_id
      ORDER BY m.id DESC
    `);
    const logs = logRows.map((m) => ({
      id: m.id,
      description: m.description,
      cost: m.cost,
      date: m.date,
      status: m.status,
      vehicleId: m.vehicleId,
      vehicle: { id: m.vehicleId, regNumber: m.vehicleRegNumber, name: m.vehicleName },
    }));

    const vehicles = await query(
      `SELECT id, reg_number AS regNumber, name FROM vehicles WHERE status != 'Retired'`
    );

    res.render("maintenance", { logs, vehicles });
  })
);

app.post(
  "/maintenance/add",
  requireLogin,
  requireRole("fleet_manager"),
  asyncRoute(async (req, res) => {
    const { vehicleId, description, cost } = req.body;
    const vId = parseInt(vehicleId);
    const today = new Date().toISOString().slice(0, 10);

    await withTransaction(async (conn) => {
      await conn.query(
        `INSERT INTO maintenance_logs (vehicle_id, description, cost, date, status)
         VALUES (?, ?, ?, ?, 'Active')`,
        [vId, description, parseFloat(cost) || 0, today]
      );
      await conn.query("UPDATE vehicles SET status = 'In Shop' WHERE id = ?", [vId]); // rule
    });

    setFlash(req, "success", "Maintenance record created. Vehicle marked In Shop.");
    res.redirect("/maintenance");
  })
);

app.post(
  "/maintenance/:id/close",
  requireLogin,
  requireRole("fleet_manager"),
  asyncRoute(async (req, res) => {
    const logId = parseInt(req.params.id);

    await withTransaction(async (conn) => {
      const [[log]] = await conn.query("SELECT * FROM maintenance_logs WHERE id = ? FOR UPDATE", [logId]);
      if (!log) return;

      await conn.query("UPDATE maintenance_logs SET status = 'Closed' WHERE id = ?", [logId]);

      const [[vehicle]] = await conn.query("SELECT * FROM vehicles WHERE id = ? FOR UPDATE", [log.vehicle_id]);
      if (vehicle && vehicle.status !== "Retired") {
        await conn.query("UPDATE vehicles SET status = 'Available' WHERE id = ?", [log.vehicle_id]); // rule
      }
    });

    setFlash(req, "success", "Maintenance closed. Vehicle restored to Available.");
    res.redirect("/maintenance");
  })
);

// ---------------------------------------------------------------
// FUEL & EXPENSES
// ---------------------------------------------------------------
app.get(
  "/fuel-expenses",
  requireLogin,
  asyncRoute(async (req, res) => {
    const vehicles = await query(`SELECT id, reg_number AS regNumber, name FROM vehicles`);

    const fuelRows = await query(`
      SELECT f.id, f.liters, f.cost, f.date,
             v.id AS vehicleId, v.reg_number AS vehicleRegNumber, v.name AS vehicleName
      FROM fuel_logs f
      JOIN vehicles v ON v.id = f.vehicle_id
      ORDER BY f.id DESC
    `);
    const fuelLogs = fuelRows.map((f) => ({
      id: f.id,
      liters: f.liters,
      cost: f.cost,
      date: f.date,
      vehicleId: f.vehicleId,
      vehicle: { id: f.vehicleId, regNumber: f.vehicleRegNumber, name: f.vehicleName },
    }));

    const expenseRows = await query(`
      SELECT e.id, e.category, e.amount, e.date,
             v.id AS vehicleId, v.reg_number AS vehicleRegNumber, v.name AS vehicleName
      FROM expenses e
      JOIN vehicles v ON v.id = e.vehicle_id
      ORDER BY e.id DESC
    `);
    const expenses = expenseRows.map((e) => ({
      id: e.id,
      category: e.category,
      amount: e.amount,
      date: e.date,
      vehicleId: e.vehicleId,
      vehicle: { id: e.vehicleId, regNumber: e.vehicleRegNumber, name: e.vehicleName },
    }));

    res.render("fuel_expenses", { fuelLogs, expenses, vehicles });
  })
);

app.post(
  "/fuel-expenses/add-fuel",
  requireLogin,
  asyncRoute(async (req, res) => {
    const { vehicleId, liters, cost, date } = req.body;
    await query("INSERT INTO fuel_logs (vehicle_id, liters, cost, date) VALUES (?, ?, ?, ?)", [
      parseInt(vehicleId),
      parseFloat(liters),
      parseFloat(cost),
      date,
    ]);
    setFlash(req, "success", "Fuel log added.");
    res.redirect("/fuel-expenses");
  })
);

app.post(
  "/fuel-expenses/add-expense",
  requireLogin,
  asyncRoute(async (req, res) => {
    const { vehicleId, category, amount, date } = req.body;
    await query("INSERT INTO expenses (vehicle_id, category, amount, date) VALUES (?, ?, ?, ?)", [
      parseInt(vehicleId),
      category,
      parseFloat(amount),
      date,
    ]);
    setFlash(req, "success", "Expense added.");
    res.redirect("/fuel-expenses");
  })
);

// ---------------------------------------------------------------
// REPORTS & ANALYTICS
// All aggregation (SUM/GROUP BY) happens in MySQL via derived tables,
// so this scales with fleet size instead of pulling every trip/fuel/
// maintenance/expense row into Node and reducing over it in JS.
// ---------------------------------------------------------------
async function computeVehicleReports() {
  const rows = await query(`
    SELECT
      v.reg_number AS regNumber,
      v.name,
      v.acquisition_cost AS acquisitionCost,
      COALESCE(tr.totalDistance, 0) AS totalDistance,
      COALESCE(tr.totalRevenue, 0) AS totalRevenue,
      COALESCE(fl.totalFuel, 0) AS totalFuel,
      COALESCE(fl.totalFuelCost, 0) AS totalFuelCost,
      COALESCE(ml.totalMaintenanceCost, 0) AS totalMaintenanceCost,
      COALESCE(ex.totalExpenses, 0) AS totalExpenses
    FROM vehicles v
    LEFT JOIN (
      SELECT vehicle_id, SUM(planned_distance) AS totalDistance, SUM(COALESCE(revenue, 0)) AS totalRevenue
      FROM trips WHERE status = 'Completed' GROUP BY vehicle_id
    ) tr ON tr.vehicle_id = v.id
    LEFT JOIN (
      SELECT vehicle_id, SUM(liters) AS totalFuel, SUM(cost) AS totalFuelCost
      FROM fuel_logs GROUP BY vehicle_id
    ) fl ON fl.vehicle_id = v.id
    LEFT JOIN (
      SELECT vehicle_id, SUM(cost) AS totalMaintenanceCost
      FROM maintenance_logs GROUP BY vehicle_id
    ) ml ON ml.vehicle_id = v.id
    LEFT JOIN (
      SELECT vehicle_id, SUM(amount) AS totalExpenses
      FROM expenses GROUP BY vehicle_id
    ) ex ON ex.vehicle_id = v.id
    ORDER BY v.id
  `);

  return rows.map((r) => {
    const operationalCost = r.totalFuelCost + r.totalMaintenanceCost + r.totalExpenses;
    const fuelEfficiency = r.totalFuel ? Math.round((r.totalDistance / r.totalFuel) * 100) / 100 : 0;
    const roi = r.acquisitionCost
      ? Math.round(((r.totalRevenue - operationalCost) / r.acquisitionCost) * 1000) / 1000
      : 0;

    return {
      regNumber: r.regNumber,
      name: r.name,
      fuelEfficiency,
      operationalCost: Math.round(operationalCost * 100) / 100,
      revenue: Math.round(r.totalRevenue * 100) / 100,
      roi,
    };
  });
}

app.get(
  "/reports",
  requireLogin,
  asyncRoute(async (req, res) => {
    const [vehicleStats] = await query(`
      SELECT
        SUM(status != 'Retired') AS activeVehicles,
        SUM(status = 'On Trip') AS onTripVehicles
      FROM vehicles
    `);
    const activeVehicles = Number(vehicleStats.activeVehicles) || 0;
    const onTripVehicles = Number(vehicleStats.onTripVehicles) || 0;
    const fleetUtilization = activeVehicles
      ? Math.round((onTripVehicles / activeVehicles) * 1000) / 10
      : 0;

    res.render("reports", { rows: await computeVehicleReports(), fleetUtilization });
  })
);

app.get(
  "/reports/export.csv",
  requireLogin,
  asyncRoute(async (req, res) => {
    const rows = await computeVehicleReports();
    const header = "regNumber,name,fuelEfficiency,operationalCost,revenue,roi";
    const lines = rows.map((r) =>
      [r.regNumber, r.name, r.fuelEfficiency, r.operationalCost, r.revenue, r.roi].join(",")
    );
    const csv = [header, ...lines].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=transitops_report.csv");
    res.send(csv);
  })
);

// ---------------------------------------------------------------
// ERROR HANDLING
// ---------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err);
  setFlash(req, "danger", "Something went wrong. Please try again.");
  res.redirect("/dashboard");
});

// ---------------------------------------------------------------
// STARTUP
// ---------------------------------------------------------------
(async () => {
  try {
    await assertConnection();
    await seed(); // create demo users on first run
    app.listen(PORT, () => {
      console.log(`TransitOps (Node/Express/MySQL) running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start: could not connect to MySQL.", err.message);
    process.exit(1);
  }
})();