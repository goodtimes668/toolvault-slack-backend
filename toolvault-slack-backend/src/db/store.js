// src/db/store.js
// ─────────────────────────────────────────────────────────────
// Simple file-based JSON database using lowdb.
// To swap for PostgreSQL/MongoDB later, just replace the
// read/write functions below – the rest of the app won't change.
// ─────────────────────────────────────────────────────────────

const low = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const dbPath = process.env.DB_PATH || "./data/db.json";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const adapter = new FileSync(dbPath);
const db = low(adapter);

// Default schema
db.defaults({
  tools: [],
  rentals: [],
  categories: [
    "Power Tools",
    "Hand Tools",
    "Heavy Equipment",
    "Safety Gear",
    "Surveying Equipment",
    "Compaction Equipment",
  ],
  alerts: [],
}).write();

// ─── Tools ────────────────────────────────────────────────────
function getAllTools() {
  return db.get("tools").value();
}

function getToolById(id) {
  return db.get("tools").find({ id }).value();
}

function getToolByName(name) {
  // Case-insensitive partial match
  const lower = name.toLowerCase();
  return db
    .get("tools")
    .filter((t) => t.name.toLowerCase().includes(lower))
    .value();
}

function addTool(tool) {
  db.get("tools").push(tool).write();
  return tool;
}

function updateTool(id, updates) {
  db.get("tools").find({ id }).assign(updates).write();
  return db.get("tools").find({ id }).value();
}

function getAvailableTools() {
  const activeRentalToolIds = db
    .get("rentals")
    .filter({ status: "active" })
    .map("toolId")
    .value();
  return db
    .get("tools")
    .filter(
      (t) =>
        !activeRentalToolIds.includes(t.id) && t.condition !== "Needs Repair"
    )
    .value();
}

// ─── Rentals ──────────────────────────────────────────────────
function getAllRentals() {
  return db.get("rentals").value();
}

function getActiveRentals() {
  return db.get("rentals").filter({ status: "active" }).value();
}

function getRentalById(id) {
  return db.get("rentals").find({ id }).value();
}

function getActiveRentalForTool(toolId) {
  return db.get("rentals").find({ toolId, status: "active" }).value();
}

function getOverdueRentals() {
  const now = new Date();
  return db
    .get("rentals")
    .filter((r) => r.status === "active" && r.expectedReturn && new Date(r.expectedReturn) < now)
    .value();
}

function addRental(rental) {
  db.get("rentals").push(rental).write();
  return rental;
}

function updateRental(id, updates) {
  db.get("rentals").find({ id }).assign(updates).write();
  return db.get("rentals").find({ id }).value();
}

// ─── Categories ───────────────────────────────────────────────
function getCategories() {
  return db.get("categories").value();
}

// ─── Alerts ───────────────────────────────────────────────────
function addAlert(alert) {
  db.get("alerts").push(alert).write();
  return alert;
}

function getAlerts() {
  return db.get("alerts").orderBy("date", "desc").take(50).value();
}

// ─── Stats ────────────────────────────────────────────────────
function getStats() {
  const tools = getAllTools();
  const active = getActiveRentals();
  const overdue = getOverdueRentals();
  const damaged = tools.filter((t) => t.damageFlagged || t.condition === "Needs Repair");
  const available = getAvailableTools();
  return {
    total: tools.length,
    available: available.length,
    checkedOut: active.length,
    overdue: overdue.length,
    damaged: damaged.length,
  };
}

module.exports = {
  getAllTools,
  getToolById,
  getToolByName,
  addTool,
  updateTool,
  getAvailableTools,
  getAllRentals,
  getActiveRentals,
  getRentalById,
  getActiveRentalForTool,
  getOverdueRentals,
  addRental,
  updateRental,
  getCategories,
  addAlert,
  getAlerts,
  getStats,
};
