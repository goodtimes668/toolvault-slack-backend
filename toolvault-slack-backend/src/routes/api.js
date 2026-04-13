const express = require("express");
const router = express.Router();
const db = require("../db/store");
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

router.get("/tools", (_req, res) => { res.json(db.getAllTools()); });
router.post("/tools", (req, res) => { const tool = { id: uid(), damageFlagged: false, ...req.body }; db.addTool(tool); res.status(201).json(tool); });
router.put("/tools/:id", (req, res) => { const tool = db.getToolById(req.params.id); if (!tool) return res.status(404).json({ error: "Tool not found" }); res.json(db.updateTool(req.params.id, req.body)); });
router.delete("/tools/:id", (req, res) => { const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync"); const d = low(new FileSync(process.env.DB_PATH||"./data/db.json")); d.get("tools").remove({ id: req.params.id }).write(); res.json({ deleted: true }); });
router.get("/rentals", (_req, res) => { res.json(db.getAllRentals()); });
router.post("/rentals", (req, res) => { const rental = { id: uid(), status: "active", createdAt: new Date().toISOString(), ...req.body }; db.addRental(rental); if (rental.toolId && rental.jobSite) db.updateTool(rental.toolId, { jobSite: rental.jobSite }); res.status(201).json(rental); });
router.put("/rentals/:id", (req, res) => { const rental = db.getRentalById(req.params.id); if (!rental) return res.status(404).json({ error: "Not found" }); const updated = db.updateRental(req.params.id, req.body); if (req.body.status === "returned" && rental.toolId) { db.updateTool(rental.toolId, { condition: req.body.returnCondition || rental.checkoutCondition, damageFlagged: req.body.damageFlagged || false, jobSite: "" }); if (req.body.damageFlagged) { const tool = db.getToolById(rental.toolId) || {}; db.addAlert({ id: uid(), type: "damage", message: `${tool.name||"Tool"} returned with damage by ${rental.checkedOutBy}. ${req.body.damageDesc||""}`, date: new Date().toISOString(), read: false }); } } res.json(updated); });
router.get("/categories", (_req, res) => { res.json(db.getCategories()); });
router.put("/categories", (req, res) => { const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync"); const d = low(new FileSync(process.env.DB_PATH||"./data/db.json")); d.set("categories", req.body.categories).write(); res.json(req.body.categories); });
router.get("/alerts", (_req, res) => { res.json(db.getAlerts()); });
router.put("/alerts/read-all", (_req, res) => { const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync"); const d = low(new FileSync(process.env.DB_PATH||"./data/db.json")); d.get("alerts").each(a => { a.read = true; }).write(); res.json({ ok: true }); });
router.get("/stats", (_req, res) => { res.json(db.getStats()); });
router.get("/manager", (_req, res) => { const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync"); const d = low(new FileSync(process.env.DB_PATH||"./data/db.json")); res.json({ name: d.get("managerName").value() || "Site Manager" }); });
router.put("/manager", (req, res) => { const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync"); const d = low(new FileSync(process.env.DB_PATH||"./data/db.json")); d.set("managerName", req.body.name).write(); res.json({ name: req.body.name }); });
module.exports = router;
