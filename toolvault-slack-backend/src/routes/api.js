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

// ─── DISPATCH BOOKINGS ────────────────────────────────────────
router.get("/bookings", (_req, res) => {
  const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync");
  const d = low(new FileSync(process.env.DB_PATH||"./data/db.json"));
  res.json(d.get("bookings").value() || []);
});

router.post("/bookings", (req, res) => {
  const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync");
  const d = low(new FileSync(process.env.DB_PATH||"./data/db.json"));
  const booking = { id: uid(), status: "pending", createdAt: new Date().toISOString(), ...req.body };
  if (!d.has("bookings").value()) d.set("bookings", []).write();
  d.get("bookings").push(booking).write();
  // Slack notification to Brent
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const brentChannel = process.env.BRENT_SLACK_ID || process.env.SLACK_MANAGER_CHANNEL_ID;
  if (slackToken && brentChannel) {
    const typeEmoji = { delivery:"📦", pickup:"🔧", "tool-delivery":"🚚", misc:"📝" }[booking.type] || "📋";
    const priorityText = booking.priority === "urgent" ? "🚨 *URGENT*" : booking.priority === "scheduled" ? "📅 Planned" : "📋 Normal";
    fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${slackToken}` },
      body: JSON.stringify({
        channel: brentChannel,
        text: `${typeEmoji} New booking request from ${booking.requester}`,
        blocks: [
          { type: "header", text: { type: "plain_text", text: `${typeEmoji} New Dispatch Request` } },
          { type: "section", fields: [
            { type: "mrkdwn", text: `*Type:*\n${booking.type}` },
            { type: "mrkdwn", text: `*From:*\n${booking.requester}` },
            { type: "mrkdwn", text: `*Site:*\n${booking.site || "TBD"}` },
            { type: "mrkdwn", text: `*Date:*\n${booking.date}${booking.time ? " at " + booking.time : ""}` },
            { type: "mrkdwn", text: `*Priority:*\n${priorityText}` },
          ]},
          { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${booking.description}` } },
          { type: "actions", elements: [
            { type: "button", text: { type: "plain_text", text: "✅ Approve" }, style: "primary", action_id: "approve_booking", value: booking.id },
            { type: "button", text: { type: "plain_text", text: "❌ Decline" }, style: "danger", action_id: "decline_booking", value: booking.id },
          ]}
        ]
      })
    }).catch(() => {});
  }
  res.status(201).json(booking);
});

router.put("/bookings/:id", (req, res) => {
  const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync");
  const d = low(new FileSync(process.env.DB_PATH||"./data/db.json"));
  const booking = d.get("bookings").find({ id: req.params.id }).value();
  if (!booking) return res.status(404).json({ error: "Booking not found" });
  d.get("bookings").find({ id: req.params.id }).assign({ ...req.body, updatedAt: new Date().toISOString() }).write();
  const updated = d.get("bookings").find({ id: req.params.id }).value();
  // Notify requester channel on status change
  const slackToken = process.env.SLACK_BOT_TOKEN;
  const channel = process.env.SLACK_MANAGER_CHANNEL_ID;
  if (slackToken && channel && req.body.status) {
    const msgs = {
      approved: `✅ Booking approved by Brent: ${booking.type} for ${booking.site} on ${booking.date}`,
      declined: `❌ Booking declined: ${booking.type} for ${booking.site}${req.body.brentNotes ? " — " + req.body.brentNotes : ""}`,
      completed: `🏁 Job completed by Brent: ${booking.type} for ${booking.site}`,
      "in-progress": `🔄 Brent is on the way: ${booking.type} for ${booking.site}`
    };
    if (msgs[req.body.status]) {
      fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${slackToken}` },
        body: JSON.stringify({ channel, text: msgs[req.body.status] })
      }).catch(() => {});
    }
  }
  res.json(updated);
});

router.delete("/bookings/:id", (req, res) => {
  const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync");
  const d = low(new FileSync(process.env.DB_PATH||"./data/db.json"));
  d.get("bookings").remove({ id: req.params.id }).write();
  res.json({ deleted: true });
});

module.exports = router;
