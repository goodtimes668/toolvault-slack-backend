// src/jobs/overdueChecker.js
// ─────────────────────────────────────────────────────────────
// Runs every hour to check for overdue rentals.
// Posts alerts to the manager's Slack channel.
// ─────────────────────────────────────────────────────────────

const db = require("../db/store");
const slack = require("../slack/api");
const blocks = require("../slack/blocks");

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// Track which rentals we've already alerted on (in-memory, resets on restart)
const alertedRentals = new Set();

async function checkOverdue() {
  const managerChannel = process.env.SLACK_MANAGER_CHANNEL_ID;
  if (!managerChannel) return; // No channel configured — skip silently

  const overdue = db.getOverdueRentals();
  const tools = db.getAllTools();

  for (const rental of overdue) {
    // Only alert once per rental per server run (prevents spam)
    if (alertedRentals.has(rental.id)) continue;

    const tool = tools.find((t) => t.id === rental.toolId);
    if (!tool) continue;

    try {
      const alertPayload = blocks.overdueAlert(tool, rental);
      await slack.postMessage(managerChannel, {
        ...alertPayload,
        text: `⚠️ Overdue: ${tool.name} — ${rental.checkedOutBy}`,
      });

      alertedRentals.add(rental.id);

      db.addAlert({
        id: uid(),
        type: "overdue",
        message: `${tool.name} is overdue. Checked out by ${rental.checkedOutBy} for ${rental.jobSite}. Was due ${rental.expectedReturn}.`,
        date: new Date().toISOString(),
        read: false,
      });

      console.log(`⚠️ Overdue alert sent for: ${tool.name} (${rental.checkedOutBy})`);
    } catch (err) {
      console.error(`Failed to send overdue alert for rental ${rental.id}:`, err.message);
    }
  }
}

function startOverdueChecker(intervalMs = 60 * 60 * 1000) {
  // Run immediately on startup
  checkOverdue().catch(console.error);
  // Then run every hour
  const interval = setInterval(() => {
    checkOverdue().catch(console.error);
  }, intervalMs);
  console.log(`🕐 Overdue checker running every ${intervalMs / 60000} minutes`);
  return interval;
}

module.exports = { startOverdueChecker, checkOverdue };
