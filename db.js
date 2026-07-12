// db.js
// Uses lowdb (v1) - a tiny JSON-file database. Data lives in data/db.json
// and looks just like plain JavaScript objects/arrays - no SQL required.

const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const bcrypt = require("bcryptjs");
const path = require("path");

const adapter = new FileSync(path.join(__dirname, "data", "db.json"));
const db = low(adapter);

// Set defaults only if db.json is empty (first run)
db.defaults({
  users: [],
  vehicles: [],
  drivers: [],
  trips: [],
  maintenanceLogs: [],
  fuelLogs: [],
  expenses: [],
  counters: { users: 0, vehicles: 0, drivers: 0, trips: 0, maintenanceLogs: 0, fuelLogs: 0, expenses: 0 },
}).write();

// Simple auto-increment id helper (like a SQL primary key)
function nextId(collectionName) {
  const counters = db.get("counters");
  const next = counters.get(collectionName).value() + 1;
  counters.set(collectionName, next).write();
  return next;
}

// Seed 4 demo users (one per role) the first time the app runs
function seed() {
  if (db.get("users").size().value() > 0) return; // already seeded

  const demoUsers = [
    { email: "manager@transitops.com", name: "Fleet Manager", role: "fleet_manager" },
    { email: "driver@transitops.com", name: "Driver User", role: "driver" },
    { email: "safety@transitops.com", name: "Safety Officer", role: "safety_officer" },
    { email: "finance@transitops.com", name: "Financial Analyst", role: "financial_analyst" },
  ];

  demoUsers.forEach((u) => {
    db.get("users")
      .push({
        id: nextId("users"),
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: bcrypt.hashSync("password123", 10),
      })
      .write();
  });

  console.log("Seeded 4 demo users. Password for all: password123");
}

module.exports = { db, nextId, seed };
