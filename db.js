// db.js
// MySQL-backed data layer using mysql2/promise with a pooled connection.
// Pooling (instead of one connection) is what makes this scale under
// concurrent requests: each query/transaction borrows a connection from
// the pool and returns it when done, instead of serializing on one socket.

require("dotenv").config();
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "transitops",
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  namedPlaceholders: true,
  decimalNumbers: true, // return DECIMAL columns as JS numbers, not strings
  dateStrings: true, // return DATE columns as "YYYY-MM-DD" strings (views expect this)
});

// Run a single query against the pool. Use this for anything that isn't
// part of a multi-statement business transaction.
async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Run a series of queries atomically. Pass an async fn that receives a
// connection and uses `conn.query(...)` for each statement. Commits on
// success, rolls back on any thrown error, and always releases the
// connection back to the pool.
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Seed 4 demo users (one per role) the first time the app runs.
async function seed() {
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM users");
  if (rows[0].count > 0) return; // already seeded

  const demoUsers = [
    { email: "manager@transitops.com", name: "Fleet Manager", role: "fleet_manager" },
    { email: "driver@transitops.com", name: "Driver User", role: "driver" },
    { email: "safety@transitops.com", name: "Safety Officer", role: "safety_officer" },
    { email: "finance@transitops.com", name: "Financial Analyst", role: "financial_analyst" },
  ];

  for (const u of demoUsers) {
    const passwordHash = bcrypt.hashSync("password123", 10);
    await pool.query(
      "INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)",
      [u.email, u.name, u.role, passwordHash]
    );
  }

  console.log("Seeded 4 demo users. Password for all: password123");
}

// Fail fast and loudly if MySQL isn't reachable at boot, instead of
// letting the first request hang or throw a confusing pool error.
async function assertConnection() {
  const conn = await pool.getConnection();
  conn.release();
}

module.exports = { pool, query, withTransaction, seed, assertConnection };
