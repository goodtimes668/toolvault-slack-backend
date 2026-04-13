// src/routes/commands.js
// ─────────────────────────────────────────────────────────────
// Handles all Slack slash commands:
//   /tv-status    — dashboard overview
//   /tv-tools     — list available / all tools
//   /tv-checkout  — open checkout modal
//   /tv-checkin   — open check-in modal
//   /tv-rentals   — list active rentals
//   /tv-overdue   — list overdue rentals
//   /tv-help      — show all commands
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const db = require("../db/store");
const slack = require("../slack/api");
const blocks = require("../slack/blocks");

// POST /slack/commands
router.post("/", async (req, res) => {
  const { command, text, trigger_id, user_id, user_name, response_url, channel_id } = req.body;
  const arg = (text || "").trim().toLowerCase();

  // Slack requires a 200 response within 3 seconds.
  // We respond immediately, then do async work.
  res.status(200).send();

  try {
    switch (command) {

      // ── /tv-status ──────────────────────────────────────────
      case "/tv-status": {
        const stats = db.getStats();
        const overdue = db.getOverdueRentals();
        const tools = db.getAllTools();
        const payload = blocks.buildDashboard(stats, overdue, tools);
        await slack.respondToCommand(response_url, { ...payload, response_type: "in_channel" });
        break;
      }

      // ── /tv-tools ───────────────────────────────────────────
      case "/tv-tools": {
        let tools;
        let title;
        if (arg === "available") {
          tools = db.getAvailableTools();
          title = `✅ Available Tools (${tools.length})`;
        } else if (arg === "damaged") {
          tools = db.getAllTools().filter((t) => t.damageFlagged || t.condition === "Needs Repair");
          title = `🚩 Damaged / Flagged Tools (${tools.length})`;
        } else if (arg) {
          // Search by name
          tools = db.getToolByName(arg);
          title = `🔍 Search Results for "${text}"`;
        } else {
          tools = db.getAllTools();
          title = `📦 All Tools (${tools.length})`;
        }
        const payload = blocks.buildToolList(tools, title);
        await slack.respondToCommand(response_url, { ...payload, response_type: "ephemeral" });
        break;
      }

      // ── /tv-checkout ────────────────────────────────────────
      case "/tv-checkout": {
        const available = db.getAvailableTools();
        if (available.length === 0) {
          await slack.respondToCommand(response_url, {
            response_type: "ephemeral",
            text: "⚠️ No tools are currently available for checkout.",
          });
          break;
        }
        const categories = db.getCategories();
        const modal = blocks.buildCheckoutModal(available, categories);
        await slack.openModal(trigger_id, modal);
        break;
      }

      // ── /tv-checkin ─────────────────────────────────────────
      case "/tv-checkin": {
        const active = db.getActiveRentals();
        if (active.length === 0) {
          await slack.respondToCommand(response_url, {
            response_type: "ephemeral",
            text: "ℹ️ No tools are currently checked out.",
          });
          break;
        }
        const tools = db.getAllTools();
        const modal = blocks.buildCheckinModal(active, tools);
        await slack.openModal(trigger_id, modal);
        break;
      }

      // ── /tv-rentals ─────────────────────────────────────────
      case "/tv-rentals": {
        const rentals = db.getActiveRentals();
        const tools = db.getAllTools();
        const payload = blocks.buildRentalList(rentals, tools);
        await slack.respondToCommand(response_url, { ...payload, response_type: "ephemeral" });
        break;
      }

      // ── /tv-overdue ─────────────────────────────────────────
      case "/tv-overdue": {
        const overdue = db.getOverdueRentals();
        const tools = db.getAllTools();
        const title = `⚠️ Overdue Rentals (${overdue.length})`;
        const payload = blocks.buildRentalList(overdue, tools);
        payload.blocks[0] = { type: "header", text: { type: "plain_text", text: title, emoji: true } };
        await slack.respondToCommand(response_url, { ...payload, response_type: "in_channel" });
        break;
      }

      // ── /tv-help ────────────────────────────────────────────
      case "/tv-help":
      default: {
        await slack.respondToCommand(response_url, {
          response_type: "ephemeral",
          blocks: [
            { type: "header", text: { type: "plain_text", text: "🔧 ToolVault Pro — Commands", emoji: true } },
            { type: "divider" },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: [
                  "`/tv-status` — Dashboard overview (stats + overdue alerts)",
                  "`/tv-tools` — All tools in inventory",
                  "`/tv-tools available` — Only available tools",
                  "`/tv-tools damaged` — Flagged / damaged tools",
                  "`/tv-tools [name]` — Search by tool name",
                  "`/tv-checkout` — Open checkout form",
                  "`/tv-checkin` — Open check-in form",
                  "`/tv-rentals` — View all active rentals",
                  "`/tv-overdue` — View overdue rentals",
                  "`/tv-help` — Show this message",
                ].join("\n"),
              },
            },
          ],
        });
        break;
      }
    }
  } catch (err) {
    console.error(`Error handling command ${command}:`, err.message);
    await slack.respondToCommand(response_url, {
      response_type: "ephemeral",
      text: `❌ Something went wrong: ${err.message}`,
    }).catch(() => {});
  }
});

module.exports = router;
