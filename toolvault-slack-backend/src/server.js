require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { verifySlackSignature } = require("./slack/verify");
const commandsRouter = require("./routes/commands");
const interactionsRouter = require("./routes/interactions");
const apiRouter = require("./routes/api");
const { startOverdueChecker } = require("./jobs/overdueChecker");

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use(bodyParser.urlencoded({ extended: true, verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }));
app.use(bodyParser.json({ verify: (req, _res, buf) => { req.rawBody = buf.toString(); } }));

app.get("/health", (_req, res) => { res.json({ status: "ok", service: "ToolVault Pro Slack Backend", ts: new Date().toISOString() }); });
app.use("/api", apiRouter);
app.use("/slack/commands", verifySlackSignature, commandsRouter);
app.use("/slack/interactions", verifySlackSignature, interactionsRouter);
app.use((_req, res) => { res.status(404).json({ error: "Not found" }); });
app.use((err, _req, res, _next) => { console.error(err.message); res.status(500).json({ error: "Internal server error" }); });

app.listen(PORT, () => {
  console.log("ToolVault Pro running on port " + PORT);
  if (process.env.SLACK_MANAGER_CHANNEL_ID) startOverdueChecker();
});

module.exports = app;
