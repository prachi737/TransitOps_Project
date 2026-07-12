// server.js
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const { db, nextId, seed } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(
  session({
    secret: "change-this-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

seed(); // create demo users on first run

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

// ---------------------------------------------------------------
// AUTH ROUTES
// ---------------------------------------------------------------
app.get("/", (req, res) => res.redirect("/dashboard"));

app.get("/login", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("login");
});

app.post("/login", (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const { password } = req.body;
  const user = db.get("users").find({ email }).value();

  if (user && bcrypt.compareSync(password, user.passwordHash)) {
    req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email };
    return res.redirect("/dashboard");
  }
  setFlash(req, "danger", "Invalid email or password.");
  res.redirect("/login");
});

app.get("/signup", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("signup");
});

app.post("/signup", (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = req.body.password || "";
  const role = req.body.role || "driver";
  const allowedRoles = ["fleet_manager", "driver", "safety_officer", "financial_analyst"];

  if (!name || !email || password.length < 6 || !allowedRoles.includes(role)) {
    setFlash(req, "danger", "Please enter a valid name, email, role, and a password with at least 6 characters.");
    return res.redirect("/signup");
  }

  const existingUser = db.get("users").find({ email }).value();
  if (existingUser) {
    setFlash(req, "danger", "An account with that email already exists.");
    return res.redirect("/signup");
  }

  const user = {
    id: nextId("users"),
    email,
    name,
    role,
    passwordHash: bcrypt.hashSync(password, 10),
  };

  db.get("users").push(user).write();
  req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email };
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ---------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------
app.get("/dashboard", requireLogin, (req, res) => {
  const vehicles = db.get("vehicles").value();
  const drivers = db.get("drivers").value();
  const trips = db.get("trips").value();

  const activeVehicles = vehicles.filter((v) => v.status !== "Retired");
  const availableVehicles = vehicles.filter((v) => v.status === "Available");
  const inMaintenance = vehicles.filter((v) => v.status === "In Shop");
  const activeTrips = trips.filter((t) => t.status === "Dispatched");
  const pendingTrips = trips.filter((t) => t.status === "Draft");
  const driversOnDuty = drivers.filter((d) => d.status === "On Trip");

  const onTrip = activeVehicles.filter((v) => v.status === "On Trip");
  const fleetUtilization = activeVehicles.length
    ? Math.round((onTrip.length / activeVehicles.length) * 1000) / 10
    : 0;

  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  const warningDate = thirtyDaysFromNow.toISOString().slice(0, 10);
  const expiredLicenses = drivers.filter((driver) => driver.licenseExpiry && driver.licenseExpiry < today);
  const expiringLicenses = drivers.filter(
    (driver) => driver.licenseExpiry && driver.licenseExpiry >= today && driver.licenseExpiry <= warningDate
  );

  const attentionItems = [
    ...expiredLicenses.map((driver) => ({
      level: "danger",
      icon: "bi-person-x-fill",
      title: "Expired driver license",
      detail: `${driver.name}'s license expired on ${driver.licenseExpiry}.`,
      href: "/drivers",
    })),
    ...expiringLicenses.map((driver) => ({
      level: "warning",
      icon: "bi-calendar-event-fill",
      title: "License expiring soon",
      detail: `${driver.name}'s license expires on ${driver.licenseExpiry}.`,
      href: "/drivers",
    })),
    ...inMaintenance.map((vehicle) => ({
      level: "warning",
      icon: "bi-tools",
      title: "Vehicle in maintenance",
      detail: `${vehicle.regNumber} — ${vehicle.name} is currently in the workshop.`,
      href: "/maintenance",
    })),
    ...pendingTrips.map((trip) => ({
      level: "info",
      icon: "bi-hourglass-split",
      title: "Trip awaiting dispatch",
      detail: `${trip.source} to ${trip.destination} is still a draft.`,
      href: "/trips",
    })),
  ];

  res.render("dashboard", {
    kpis: {
      activeVehicles: activeVehicles.length,
      availableVehicles: availableVehicles.length,
      inMaintenance: inMaintenance.length,
      activeTrips: activeTrips.length,
      pendingTrips: pendingTrips.length,
      driversOnDuty: driversOnDuty.length,
      fleetUtilization,
    },
<<<<<<< Updated upstream
=======
    chartData: {
      labels: ["Available", "On Trip", "In Shop", "Retired"],
      values: [
        availableVehicles.length,
        onTrip.length,
        inMaintenance.length,
        filteredVehicles.filter((v) => v.status === "Retired").length,
      ],
    },
    attentionItems,
    filters: {
      types: allTypes,
      regions: allRegions,
      statuses: allStatuses,
      selectedType: type || "",
      selectedStatus: status || "",
      selectedRegion: region || "",
    }
>>>>>>> Stashed changes
  });
});

// ---------------------------------------------------------------
// VEHICLE REGISTRY
// ---------------------------------------------------------------
app.get("/vehicles", requireLogin, (req, res) => {
  res.render("vehicles", { vehicles: db.get("vehicles").value() });
});

app.post("/vehicles/add", requireLogin, requireRole("fleet_manager"), (req, res) => {
  const { regNumber, name, type, maxLoad, odometer, acquisitionCost } = req.body;

  if (db.get("vehicles").find({ regNumber }).value()) {
    setFlash(req, "danger", "Registration number must be unique.");
    return res.redirect("/vehicles");
  }

  db.get("vehicles")
    .push({
      id: nextId("vehicles"),
      regNumber,
      name,
      type,
      maxLoad: parseFloat(maxLoad),
      odometer: parseFloat(odometer) || 0,
      acquisitionCost: parseFloat(acquisitionCost) || 0,
      status: "Available",
    })
    .write();

  setFlash(req, "success", "Vehicle registered.");
  res.redirect("/vehicles");
});

// ---------------------------------------------------------------
// DRIVER MANAGEMENT
// ---------------------------------------------------------------
app.get("/drivers", requireLogin, (req, res) => {
  res.render("drivers", {
    drivers: db.get("drivers").value(),
    today: new Date().toISOString().slice(0, 10),
  });
});

app.post("/drivers/add", requireLogin, requireRole("fleet_manager", "safety_officer"), (req, res) => {
  const { name, licenseNumber, licenseCategory, licenseExpiry, contactNumber, safetyScore } = req.body;

  if (db.get("drivers").find({ licenseNumber }).value()) {
    setFlash(req, "danger", "License number must be unique.");
    return res.redirect("/drivers");
  }

  db.get("drivers")
    .push({
      id: nextId("drivers"),
      name,
      licenseNumber,
      licenseCategory,
      licenseExpiry, // stored as "YYYY-MM-DD" string, compares fine lexically
      contactNumber,
      safetyScore: parseInt(safetyScore) || 100,
      status: "Available",
    })
    .write();

  setFlash(req, "success", "Driver added.");
  res.redirect("/drivers");
});

// ---------------------------------------------------------------
// TRIP MANAGEMENT (business rules live here)
// ---------------------------------------------------------------
app.get("/trips", requireLogin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const trips = db.get("trips").value();
  const vehicles = db.get("vehicles").value();
  const drivers = db.get("drivers").value();

  // attach vehicle/driver objects for display
  const tripsWithRefs = trips
    .slice()
    .reverse()
    .map((t) => ({
      ...t,
      vehicle: vehicles.find((v) => v.id === t.vehicleId),
      driver: drivers.find((d) => d.id === t.driverId),
    }));

  const eligibleVehicles = vehicles.filter((v) => v.status === "Available");
  const eligibleDrivers = drivers.filter((d) => d.status === "Available" && d.licenseExpiry >= today);

  res.render("trips", { trips: tripsWithRefs, vehicles: eligibleVehicles, drivers: eligibleDrivers });
});

app.post("/trips/create", requireLogin, (req, res) => {
  const { source, destination, vehicleId, driverId, cargoWeight, plannedDistance } = req.body;
  const today = new Date().toISOString().slice(0, 10);

  const vehicle = db.get("vehicles").find({ id: parseInt(vehicleId) }).value();
  const driver = db.get("drivers").find({ id: parseInt(driverId) }).value();
  const cargo = parseFloat(cargoWeight);

  if (!vehicle || vehicle.status !== "Available") {
    setFlash(req, "danger", "Vehicle is not available for dispatch.");
    return res.redirect("/trips");
  }
  if (!driver || driver.status !== "Available" || driver.licenseExpiry < today) {
    setFlash(req, "danger", "Driver is not eligible (expired license or unavailable).");
    return res.redirect("/trips");
  }
  if (cargo > vehicle.maxLoad) {
    setFlash(req, "danger", `Cargo weight (${cargo}kg) exceeds vehicle capacity (${vehicle.maxLoad}kg).`);
    return res.redirect("/trips");
  }

  db.get("trips")
    .push({
      id: nextId("trips"),
      source,
      destination,
      vehicleId: vehicle.id,
      driverId: driver.id,
      cargoWeight: cargo,
      plannedDistance: parseFloat(plannedDistance),
      status: "Draft",
      finalOdometer: null,
      fuelConsumed: null,
      revenue: null,
      createdAt: new Date().toISOString(),
    })
    .write();

  setFlash(req, "success", "Trip created as Draft.");
  res.redirect("/trips");
});

app.post("/trips/:id/dispatch", requireLogin, (req, res) => {
  const trip = db.get("trips").find({ id: parseInt(req.params.id) });
  const tripVal = trip.value();
  if (!tripVal || tripVal.status !== "Draft") {
    setFlash(req, "danger", "Only Draft trips can be dispatched.");
    return res.redirect("/trips");
  }

  trip.assign({ status: "Dispatched" }).write();
  db.get("vehicles").find({ id: tripVal.vehicleId }).assign({ status: "On Trip" }).write();
  db.get("drivers").find({ id: tripVal.driverId }).assign({ status: "On Trip" }).write();

  setFlash(req, "success", "Trip dispatched.");
  res.redirect("/trips");
});

app.post("/trips/:id/complete", requireLogin, (req, res) => {
  const trip = db.get("trips").find({ id: parseInt(req.params.id) });
  const tripVal = trip.value();
  if (!tripVal || tripVal.status !== "Dispatched") {
    setFlash(req, "danger", "Only Dispatched trips can be completed.");
    return res.redirect("/trips");
  }

  const finalOdometer = parseFloat(req.body.finalOdometer);
  const fuelConsumed = parseFloat(req.body.fuelConsumed);
  const revenue = parseFloat(req.body.revenue) || 0;

  trip.assign({ status: "Completed", finalOdometer, fuelConsumed, revenue }).write();
  db.get("vehicles").find({ id: tripVal.vehicleId }).assign({ status: "Available", odometer: finalOdometer }).write();
  db.get("drivers").find({ id: tripVal.driverId }).assign({ status: "Available" }).write();

  // Auto-log the fuel used, so Reports picks it up (placeholder rate)
  db.get("fuelLogs")
    .push({
      id: nextId("fuelLogs"),
      vehicleId: tripVal.vehicleId,
      liters: fuelConsumed,
      cost: fuelConsumed * 100,
      date: new Date().toISOString().slice(0, 10),
    })
    .write();

  setFlash(req, "success", "Trip completed.");
  res.redirect("/trips");
});

app.post("/trips/:id/cancel", requireLogin, (req, res) => {
  const trip = db.get("trips").find({ id: parseInt(req.params.id) });
  const tripVal = trip.value();
  if (!tripVal || !["Draft", "Dispatched"].includes(tripVal.status)) {
    setFlash(req, "danger", "This trip can no longer be cancelled.");
    return res.redirect("/trips");
  }

  if (tripVal.status === "Dispatched") {
    db.get("vehicles").find({ id: tripVal.vehicleId }).assign({ status: "Available" }).write();
    db.get("drivers").find({ id: tripVal.driverId }).assign({ status: "Available" }).write();
  }
  trip.assign({ status: "Cancelled" }).write();

  setFlash(req, "success", "Trip cancelled.");
  res.redirect("/trips");
});

// ---------------------------------------------------------------
// MAINTENANCE
// ---------------------------------------------------------------
app.get("/maintenance", requireLogin, (req, res) => {
  const vehicles = db.get("vehicles").value();
  const logs = db
    .get("maintenanceLogs")
    .value()
    .slice()
    .reverse()
    .map((m) => ({ ...m, vehicle: vehicles.find((v) => v.id === m.vehicleId) }));

  res.render("maintenance", { logs, vehicles: vehicles.filter((v) => v.status !== "Retired") });
});

app.post("/maintenance/add", requireLogin, requireRole("fleet_manager"), (req, res) => {
  const { vehicleId, description, cost } = req.body;
  const vId = parseInt(vehicleId);

  db.get("maintenanceLogs")
    .push({
      id: nextId("maintenanceLogs"),
      vehicleId: vId,
      description,
      cost: parseFloat(cost) || 0,
      date: new Date().toISOString().slice(0, 10),
      status: "Active",
    })
    .write();

  db.get("vehicles").find({ id: vId }).assign({ status: "In Shop" }).write(); // rule

  setFlash(req, "success", "Maintenance record created. Vehicle marked In Shop.");
  res.redirect("/maintenance");
});

app.post("/maintenance/:id/close", requireLogin, requireRole("fleet_manager"), (req, res) => {
  const log = db.get("maintenanceLogs").find({ id: parseInt(req.params.id) });
  const logVal = log.value();
  log.assign({ status: "Closed" }).write();

  const vehicle = db.get("vehicles").find({ id: logVal.vehicleId });
  if (vehicle.value().status !== "Retired") {
    vehicle.assign({ status: "Available" }).write(); // rule
  }

  setFlash(req, "success", "Maintenance closed. Vehicle restored to Available.");
  res.redirect("/maintenance");
});

// ---------------------------------------------------------------
// FUEL & EXPENSES
// ---------------------------------------------------------------
app.get("/fuel-expenses", requireLogin, (req, res) => {
  const vehicles = db.get("vehicles").value();
  const fuelLogs = db
    .get("fuelLogs")
    .value()
    .slice()
    .reverse()
    .map((f) => ({ ...f, vehicle: vehicles.find((v) => v.id === f.vehicleId) }));
  const expenses = db
    .get("expenses")
    .value()
    .slice()
    .reverse()
    .map((e) => ({ ...e, vehicle: vehicles.find((v) => v.id === e.vehicleId) }));

  res.render("fuel_expenses", { fuelLogs, expenses, vehicles });
});

app.post("/fuel-expenses/add-fuel", requireLogin, (req, res) => {
  const { vehicleId, liters, cost, date } = req.body;
  db.get("fuelLogs")
    .push({
      id: nextId("fuelLogs"),
      vehicleId: parseInt(vehicleId),
      liters: parseFloat(liters),
      cost: parseFloat(cost),
      date,
    })
    .write();
  setFlash(req, "success", "Fuel log added.");
  res.redirect("/fuel-expenses");
});

app.post("/fuel-expenses/add-expense", requireLogin, (req, res) => {
  const { vehicleId, category, amount, date } = req.body;
  db.get("expenses")
    .push({
      id: nextId("expenses"),
      vehicleId: parseInt(vehicleId),
      category,
      amount: parseFloat(amount),
      date,
    })
    .write();
  setFlash(req, "success", "Expense added.");
  res.redirect("/fuel-expenses");
});

// ---------------------------------------------------------------
// REPORTS & ANALYTICS
// ---------------------------------------------------------------
function computeVehicleReports() {
  const vehicles = db.get("vehicles").value();
  const trips = db.get("trips").value();
  const fuelLogs = db.get("fuelLogs").value();
  const maintenanceLogs = db.get("maintenanceLogs").value();
  const expenses = db.get("expenses").value();

  return vehicles.map((v) => {
    const vTrips = trips.filter((t) => t.vehicleId === v.id);
    const completedTrips = vTrips.filter((t) => t.status === "Completed");
    const totalDistance = completedTrips.reduce((sum, t) => sum + t.plannedDistance, 0);
    const totalRevenue = completedTrips.reduce((sum, t) => sum + (t.revenue || 0), 0);

    const vFuel = fuelLogs.filter((f) => f.vehicleId === v.id);
    const totalFuel = vFuel.reduce((sum, f) => sum + f.liters, 0);
    const totalFuelCost = vFuel.reduce((sum, f) => sum + f.cost, 0);

    const totalMaintenanceCost = maintenanceLogs
      .filter((m) => m.vehicleId === v.id)
      .reduce((sum, m) => sum + m.cost, 0);

    const totalExpenses = expenses.filter((e) => e.vehicleId === v.id).reduce((sum, e) => sum + e.amount, 0);

    const fuelEfficiency = totalFuel ? Math.round((totalDistance / totalFuel) * 100) / 100 : 0;
    const operationalCost = totalFuelCost + totalMaintenanceCost + totalExpenses;
    const roi = v.acquisitionCost
      ? Math.round(((totalRevenue - operationalCost) / v.acquisitionCost) * 1000) / 1000
      : 0;

    return {
      regNumber: v.regNumber,
      name: v.name,
      fuelEfficiency,
      operationalCost: Math.round(operationalCost * 100) / 100,
      revenue: Math.round(totalRevenue * 100) / 100,
      roi,
    };
  });
}

app.get("/reports", requireLogin, (req, res) => {
  const vehicles = db.get("vehicles").value();
  const activeVehicles = vehicles.filter((v) => v.status !== "Retired");
  const onTrip = activeVehicles.filter((v) => v.status === "On Trip");
  const fleetUtilization = activeVehicles.length
    ? Math.round((onTrip.length / activeVehicles.length) * 1000) / 10
    : 0;

  res.render("reports", { rows: computeVehicleReports(), fleetUtilization });
});

app.get("/reports/export.csv", requireLogin, (req, res) => {
  const rows = computeVehicleReports();
  const header = "regNumber,name,fuelEfficiency,operationalCost,revenue,roi";
  const lines = rows.map((r) =>
    [r.regNumber, r.name, r.fuelEfficiency, r.operationalCost, r.revenue, r.roi].join(",")
  );
  const csv = [header, ...lines].join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=transitops_report.csv");
  res.send(csv);
});

app.listen(PORT, () => {
  console.log(`TransitOps (Node/Express) running at http://localhost:${PORT}`);
});
