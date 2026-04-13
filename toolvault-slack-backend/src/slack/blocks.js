// src/slack/blocks.js
// ─────────────────────────────────────────────────────────────
// Block Kit builders for all Slack messages and modals.
// Slack's Block Kit renders rich, interactive UI inside Slack.
// ─────────────────────────────────────────────────────────────

function fmt(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function isOverdue(dateStr) {
  return dateStr && new Date(dateStr) < new Date();
}

const COND_EMOJI = {
  Excellent: "🟢",
  Good: "🔵",
  Fair: "🟡",
  "Needs Repair": "🔴",
};

// ─── Dashboard / Status ───────────────────────────────────────
function buildDashboard(stats, overdueRentals, tools) {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "🔧 ToolVault Pro — Dashboard", emoji: true },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Total Tools*\n${stats.total}` },
        { type: "mrkdwn", text: `*✅ Available*\n${stats.available}` },
        { type: "mrkdwn", text: `*📤 Checked Out*\n${stats.checkedOut}` },
        { type: "mrkdwn", text: `*⚠️ Overdue*\n${stats.overdue}` },
        { type: "mrkdwn", text: `*🚩 Damaged*\n${stats.damaged}` },
      ],
    },
  ];

  if (overdueRentals.length > 0) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `⚠️ *${overdueRentals.length} Overdue Rental${overdueRentals.length > 1 ? "s" : ""}* — Follow up immediately:` },
    });
    overdueRentals.slice(0, 5).forEach((r) => {
      const tool = tools.find((t) => t.id === r.toolId) || {};
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `• *${tool.name || "Unknown Tool"}* — ${r.checkedOutBy}${r.company ? ` (${r.company})` : ""}\n  📍 ${r.jobSite} | Due: ${fmt(r.expectedReturn)}`,
        },
      });
    });
  }

  blocks.push({ type: "divider" });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: { type: "plain_text", text: "📤 Check Out Tool", emoji: true }, action_id: "open_checkout", style: "primary" },
      { type: "button", text: { type: "plain_text", text: "📥 Check In Tool", emoji: true }, action_id: "open_checkin" },
      { type: "button", text: { type: "plain_text", text: "📋 View All Rentals", emoji: true }, action_id: "view_rentals" },
    ],
  });

  return { blocks };
}

// ─── Tool List ─────────────────────────────────────────────────
function buildToolList(tools, title = "📦 Tool Inventory") {
  if (tools.length === 0) {
    return {
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${title}*\n\nNo tools found.` } },
      ],
    };
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: title, emoji: true } },
    { type: "divider" },
  ];

  tools.slice(0, 20).forEach((tool) => {
    const condEmoji = COND_EMOJI[tool.condition] || "⚪";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${tool.name}*\n${condEmoji} ${tool.condition} | 📁 ${tool.category}${tool.serialNumber ? ` | SN: \`${tool.serialNumber}\`` : ""}${tool.jobSite ? ` | 📍 ${tool.jobSite}` : ""}`,
      },
    });
  });

  if (tools.length > 20) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `_...and ${tools.length - 20} more tools. Use the web app to see all._` }],
    });
  }

  return { blocks };
}

// ─── Active Rentals List ───────────────────────────────────────
function buildRentalList(rentals, tools) {
  if (rentals.length === 0) {
    return {
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: "*📋 Active Rentals*\n\nNo tools currently checked out." } },
      ],
    };
  }

  const blocks = [
    { type: "header", text: { type: "plain_text", text: `📋 Active Rentals (${rentals.length})`, emoji: true } },
    { type: "divider" },
  ];

  rentals.slice(0, 15).forEach((r) => {
    const tool = tools.find((t) => t.id === r.toolId) || {};
    const overdue = isOverdue(r.expectedReturn);
    const statusEmoji = overdue ? "⚠️" : "✅";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusEmoji} *${tool.name || "Unknown"}*\n👤 ${r.checkedOutBy}${r.company ? ` · ${r.company}` : ""} | 📍 ${r.jobSite}\n📅 Due: *${fmt(r.expectedReturn)}*${overdue ? " — *OVERDUE*" : ""} | Type: ${r.rentalType}`,
      },
    });
  });

  return { blocks };
}

// ─── Checkout Modal ────────────────────────────────────────────
function buildCheckoutModal(availableTools, categories) {
  const toolOptions = availableTools.map((t) => ({
    text: { type: "plain_text", text: `${t.name}${t.assetTag ? ` · ${t.assetTag}` : ""}`, emoji: true },
    value: t.id,
  }));

  if (toolOptions.length === 0) {
    return null; // Signal that no tools are available
  }

  return {
    type: "modal",
    callback_id: "checkout_submit",
    title: { type: "plain_text", text: "📤 Check Out Tool", emoji: true },
    submit: { type: "plain_text", text: "Confirm Check Out", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "tool_select",
        label: { type: "plain_text", text: "Select Tool", emoji: true },
        element: {
          type: "static_select",
          action_id: "tool_id",
          placeholder: { type: "plain_text", text: "Choose an available tool", emoji: true },
          options: toolOptions,
        },
      },
      {
        type: "input",
        block_id: "rental_type",
        label: { type: "plain_text", text: "Rental Type", emoji: true },
        element: {
          type: "static_select",
          action_id: "type",
          initial_option: { text: { type: "plain_text", text: "👷 Internal (Employee)", emoji: true }, value: "internal" },
          options: [
            { text: { type: "plain_text", text: "👷 Internal (Employee)", emoji: true }, value: "internal" },
            { text: { type: "plain_text", text: "🏗️ External (Sub / Client)", emoji: true }, value: "external" },
          ],
        },
      },
      {
        type: "input",
        block_id: "recipient_name",
        label: { type: "plain_text", text: "Full Name of Recipient", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "name",
          placeholder: { type: "plain_text", text: "Who is taking this tool?", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "employee_or_company",
        label: { type: "plain_text", text: "Employee ID or Company Name", emoji: true },
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "emp_company",
          placeholder: { type: "plain_text", text: "EMP-XXXX or company name", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "job_site",
        label: { type: "plain_text", text: "Job Site", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "site",
          placeholder: { type: "plain_text", text: "Site name or address", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "expected_return",
        label: { type: "plain_text", text: "Expected Return Date", emoji: true },
        element: {
          type: "datepicker",
          action_id: "return_date",
          placeholder: { type: "plain_text", text: "Select a date", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "checkout_condition",
        label: { type: "plain_text", text: "Condition at Checkout", emoji: true },
        element: {
          type: "static_select",
          action_id: "condition",
          initial_option: { text: { type: "plain_text", text: "Good", emoji: true }, value: "Good" },
          options: ["Excellent", "Good", "Fair", "Needs Repair"].map((c) => ({
            text: { type: "plain_text", text: `${COND_EMOJI[c]} ${c}`, emoji: true },
            value: c,
          })),
        },
      },
      {
        type: "input",
        block_id: "notes",
        optional: true,
        label: { type: "plain_text", text: "Notes / Accessories", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "notes_text",
          multiline: true,
          placeholder: { type: "plain_text", text: "Any accessories, attachments, or notes…", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "signature",
        label: { type: "plain_text", text: "Digital Signature (type full name)", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "sig",
          placeholder: { type: "plain_text", text: "Recipient types their full name to confirm", emoji: true },
        },
      },
    ],
  };
}

// ─── Check-In Modal ────────────────────────────────────────────
function buildCheckinModal(activeRentals, tools) {
  const rentalOptions = activeRentals.map((r) => {
    const tool = tools.find((t) => t.id === r.toolId) || {};
    const overdue = isOverdue(r.expectedReturn) ? " ⚠️ OVERDUE" : "";
    return {
      text: { type: "plain_text", text: `${tool.name || "Unknown"} — ${r.checkedOutBy}${overdue}`, emoji: true },
      value: r.id,
    };
  });

  if (rentalOptions.length === 0) {
    return null;
  }

  return {
    type: "modal",
    callback_id: "checkin_submit",
    title: { type: "plain_text", text: "📥 Check In Tool", emoji: true },
    submit: { type: "plain_text", text: "Confirm Check In", emoji: true },
    close: { type: "plain_text", text: "Cancel", emoji: true },
    blocks: [
      {
        type: "input",
        block_id: "rental_select",
        label: { type: "plain_text", text: "Select Tool Being Returned", emoji: true },
        element: {
          type: "static_select",
          action_id: "rental_id",
          placeholder: { type: "plain_text", text: "Choose rental to close", emoji: true },
          options: rentalOptions,
        },
      },
      {
        type: "input",
        block_id: "return_condition",
        label: { type: "plain_text", text: "Return Condition", emoji: true },
        element: {
          type: "static_select",
          action_id: "condition",
          initial_option: { text: { type: "plain_text", text: "Good", emoji: true }, value: "Good" },
          options: ["Excellent", "Good", "Fair", "Needs Repair"].map((c) => ({
            text: { type: "plain_text", text: `${COND_EMOJI[c]} ${c}`, emoji: true },
            value: c,
          })),
        },
      },
      {
        type: "input",
        block_id: "damage_flagged",
        label: { type: "plain_text", text: "Flag Damage?", emoji: true },
        element: {
          type: "static_select",
          action_id: "damage",
          initial_option: { text: { type: "plain_text", text: "No damage", emoji: true }, value: "no" },
          options: [
            { text: { type: "plain_text", text: "No damage", emoji: true }, value: "no" },
            { text: { type: "plain_text", text: "🚩 Yes — flag as damaged", emoji: true }, value: "yes" },
          ],
        },
      },
      {
        type: "input",
        block_id: "damage_desc",
        optional: true,
        label: { type: "plain_text", text: "Damage Description (if any)", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "damage_text",
          multiline: true,
          placeholder: { type: "plain_text", text: "Describe any damage in detail…", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "return_notes",
        optional: true,
        label: { type: "plain_text", text: "Return Notes", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "notes_text",
          multiline: true,
          placeholder: { type: "plain_text", text: "Missing parts, condition notes…", emoji: true },
        },
      },
      {
        type: "input",
        block_id: "return_signature",
        label: { type: "plain_text", text: "Return Signature (type full name)", emoji: true },
        element: {
          type: "plain_text_input",
          action_id: "sig",
          placeholder: { type: "plain_text", text: "Person returning types their full name", emoji: true },
        },
      },
    ],
  };
}

// ─── Confirmation Messages ─────────────────────────────────────
function checkoutConfirmation(tool, rental) {
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `✅ *Tool Checked Out Successfully*\n\n*${tool.name}* has been checked out to *${rental.checkedOutBy}*`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Job Site:*\n${rental.jobSite}` },
          { type: "mrkdwn", text: `*Return Date:*\n${fmt(rental.expectedReturn)}` },
          { type: "mrkdwn", text: `*Type:*\n${rental.rentalType}` },
          { type: "mrkdwn", text: `*Condition:*\n${COND_EMOJI[rental.checkoutCondition]} ${rental.checkoutCondition}` },
        ],
      },
      rental.notes
        ? { type: "context", elements: [{ type: "mrkdwn", text: `📝 Notes: ${rental.notes}` }] }
        : null,
    ].filter(Boolean),
  };
}

function checkinConfirmation(tool, rental) {
  const dmg = rental.damageFlagged;
  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${dmg ? "🚩" : "✅"} *Tool Checked In${dmg ? " — Damage Flagged" : " Successfully"}*\n\n*${tool.name}* returned by *${rental.checkedOutBy}*`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Return Condition:*\n${COND_EMOJI[rental.returnCondition]} ${rental.returnCondition}` },
          { type: "mrkdwn", text: `*Job Site:*\n${rental.jobSite}` },
        ],
      },
      dmg
        ? {
            type: "section",
            text: { type: "mrkdwn", text: `⚠️ *Damage Report:* ${rental.damageDesc}\n_Manager has been notified._` },
          }
        : null,
    ].filter(Boolean),
  };
}

function damageAlert(tool, rental) {
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🚨 Damage Alert", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${tool.name}* was returned with damage by *${rental.checkedOutBy}*${rental.company ? ` (${rental.company})` : ""}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Job Site:*\n${rental.jobSite}` },
          { type: "mrkdwn", text: `*Return Condition:*\n${COND_EMOJI[rental.returnCondition]} ${rental.returnCondition}` },
          { type: "mrkdwn", text: `*Damage Description:*\n${rental.damageDesc}` },
          { type: "mrkdwn", text: `*Date:*\n${fmt(new Date().toISOString())}` },
        ],
      },
    ],
  };
}

function overdueAlert(tool, rental) {
  return {
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "⚠️ Overdue Return Reminder", emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${tool.name}* is overdue for return.\n\nChecked out by *${rental.checkedOutBy}*${rental.company ? ` (${rental.company})` : ""} — was due *${fmt(rental.expectedReturn)}*\n📍 Job Site: ${rental.jobSite}`,
        },
      },
    ],
  };
}

module.exports = {
  buildDashboard,
  buildToolList,
  buildRentalList,
  buildCheckoutModal,
  buildCheckinModal,
  checkoutConfirmation,
  checkinConfirmation,
  damageAlert,
  overdueAlert,
};
