// server.js
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const bcrypt = require("bcryptjs");
const { db, nextId, seed } = require("./db");

const app = express();
const PORT = 3000;

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
  res.render("login");
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.get("users").find({ email }).value();

  if (user && bcrypt.compareSync(password, user.passwordHash)) {
    req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email };
    return res.redirect("/dashboard");
  }
  setFlash(req, "danger", "Invalid email or password.");
  res.redirect("/login");
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

  // Extract unique filters from db
  const allTypes = [...new Set(vehicles.map((v) => v.type).filter(Boolean))];
  const allRegions = [...new Set(vehicles.map((v) => v.region).filter(Boolean))];
  const allStatuses = ["Available", "On Trip", "In Shop", "Retired"];

  const { type, status, region } = req.query;

  // Apply filters
  let filteredVehicles = vehicles;
  if (type) {
    filteredVehicles = filteredVehicles.filter((v) => v.type === type);
  }
  if (status) {
    filteredVehicles = filteredVehicles.filter((v) => v.status === status);
  }
  if (region) {
    filteredVehicles = filteredVehicles.filter((v) => v.region === region);
  }

  const activeVehicles = filteredVehicles.filter((v) => v.status !== "Retired");
  const availableVehicles = filteredVehicles.filter((v) => v.status === "Available");
  const inMaintenance = filteredVehicles.filter((v) => v.status === "In Shop");
  
  const filteredVehicleIds = filteredVehicles.map((v) => v.id);
  const activeTrips = trips.filter((t) => t.status === "Dispatched" && filteredVehicleIds.includes(t.vehicleId));
  const pendingTrips = trips.filter((t) => t.status === "Draft" && filteredVehicleIds.includes(t.vehicleId));
  
  // Drivers on duty on the active trips of these filtered vehicles
  const activeTripDriverIds = activeTrips.map((t) => t.driverId);
  const driversOnDuty = drivers.filter((d) => activeTripDriverIds.includes(d.id));

  const onTrip = activeVehicles.filter((v) => v.status === "On Trip");
  const fleetUtilization = activeVehicles.length
    ? Math.round((onTrip.length / activeVehicles.length) * 1000) / 10
    : 0;

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
    filters: {
      types: allTypes,
      regions: allRegions,
      statuses: allStatuses,
      selectedType: type || "",
      selectedStatus: status || "",
      selectedRegion: region || "",
    }
  });
});

// ---------------------------------------------------------------
// VEHICLE REGISTRY
// ---------------------------------------------------------------
app.get("/vehicles", requireLogin, (req, res) => {
  res.render("vehicles", { vehicles: db.get("vehicles").value() });
});

app.post("/vehicles/add", requireLogin, requireRole("fleet_manager"), (req, res) => {
  const { regNumber, name, type, maxLoad, odometer, acquisitionCost, region } = req.body;

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
      region: region || "Unassigned"
    })
    .write();

  setFlash(req, "success", "Vehicle registered.");
  res.redirect("/vehicles");
});

app.post("/vehicles/:id/edit", requireLogin, requireRole("fleet_manager"), (req, res) => {
  const { name, type, maxLoad, odometer, acquisitionCost, region } = req.body;
  const vehicle = db.get("vehicles").find({ id: parseInt(req.params.id) });
  
  if (!vehicle.value()) {
    setFlash(req, "danger", "Vehicle not found.");
    return res.redirect("/vehicles");
  }

  vehicle.assign({
    name,
    type,
    maxLoad: parseFloat(maxLoad),
    odometer: parseFloat(odometer) || 0,
    acquisitionCost: parseFloat(acquisitionCost) || 0,
    region: region || "Unassigned"
  }).write();

  setFlash(req, "success", "Vehicle details updated.");
  res.redirect("/vehicles");
});

app.post("/vehicles/:id/retire", requireLogin, requireRole("fleet_manager"), (req, res) => {
  const vehicle = db.get("vehicles").find({ id: parseInt(req.params.id) });
  const vVal = vehicle.value();

  if (!vVal) {
    setFlash(req, "danger", "Vehicle not found.");
    return res.redirect("/vehicles");
  }

  if (vVal.status === "On Trip") {
    setFlash(req, "danger", "Cannot retire a vehicle that is currently On Trip.");
    return res.redirect("/vehicles");
  }

  const newStatus = vVal.status === "Retired" ? "Available" : "Retired";
  vehicle.assign({ status: newStatus }).write();

  setFlash(req, "success", `Vehicle status updated to ${newStatus}.`);
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
      licenseExpiry, // stored as "YYYY-MM-DD" string
      contactNumber,
      safetyScore: parseInt(safetyScore) || 100,
      status: "Available",
    })
    .write();

  setFlash(req, "success", "Driver added successfully.");
  res.redirect("/drivers");
});

app.post("/drivers/:id/edit", requireLogin, requireRole("fleet_manager", "safety_officer"), (req, res) => {
  const { name, licenseNumber, licenseCategory, licenseExpiry, contactNumber, safetyScore } = req.body;
  const driver = db.get("drivers").find({ id: parseInt(req.params.id) });

  if (!driver.value()) {
    setFlash(req, "danger", "Driver not found.");
    return res.redirect("/drivers");
  }

  driver.assign({
    name,
    licenseNumber,
    licenseCategory,
    licenseExpiry,
    contactNumber,
    safetyScore: parseInt(safetyScore) || 100
  }).write();

  setFlash(req, "success", "Driver details updated.");
  res.redirect("/drivers");
});

app.post("/drivers/:id/suspend", requireLogin, requireRole("fleet_manager", "safety_officer"), (req, res) => {
  const driver = db.get("drivers").find({ id: parseInt(req.params.id) });
  const dVal = driver.value();

  if (!dVal) {
    setFlash(req, "danger", "Driver not found.");
    return res.redirect("/drivers");
  }

  if (dVal.status === "On Trip") {
    setFlash(req, "danger", "Cannot suspend a driver who is currently On Trip.");
    return res.redirect("/drivers");
  }

  const newStatus = dVal.status === "Suspended" ? "Available" : "Suspended";
  driver.assign({ status: newStatus }).write();

  setFlash(req, "success", `Driver is now ${newStatus}.`);
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
