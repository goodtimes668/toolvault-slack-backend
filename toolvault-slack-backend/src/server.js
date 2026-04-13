// src/server.js
// ─────────────────────────────────────────────────────────────
// ToolVault Pro — Slack Backend
// Express server that handles Slack slash commands,
// interactive modals, and overdue alerts.
// ─────────────────────────────────────────────────────────────

require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { verifySlackSignature } = require("./slack/verify");
const commandsRouter = require("./routes/commands");
const interactionsRouter = require("./routes/interactions");
const { startOverdueChecker } = require("./jobs/overdueChecker");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Raw body capture (needed for Slack signature verification) ─
app.use(
  bodyParser.urlencoded({
    extended: true,
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
  })
);
app.use(
  bodyParser.json({
    verify: (req, _res, buf) => { req.rawBody = buf.toString(); },
  })
);

// ─── Health check (no auth needed) ──────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ToolVault Pro Slack Backend", ts: new Date().toISOString() });
});

// ─── Slack routes (all verified) ────────────────────────────
app.use("/slack/commands", verifySlackSignature, commandsRouter);
app.use("/slack/interactions", verifySlackSignature, interactionsRouter);

// ─── 404 handler ─────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// ─── Global error handler ─────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
🔧 ToolVault Pro — Slack Backend
────────────────────────────────
Server:   http://localhost:${PORT}
Health:   http://localhost:${PORT}/health
Commands: POST /slack/commands
Actions:  POST /slack/interactions
────────────────────────────────
`);

  // Start overdue rental checker (runs every hour)
  if (process.env.SLACK_MANAGER_CHANNEL_ID) {
    startOverdueChecker();
  } else {
    console.warn("⚠️  SLACK_MANAGER_CHANNEL_ID not set — overdue alerts disabled");
  }
});

module.exports = app;
