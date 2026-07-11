// src/routes/dispatch-interactions.js
// ─────────────────────────────────────────────────────────────
// Handles Slack interactive payloads for the GT Mann Dispatch app
// specifically — a separate Slack app from ToolVault Pro, with
// its own bot token (DISPATCH_SLACK_BOT_TOKEN) and its own signing
// secret (checked in server.js via createSlackVerifier). This file
// deliberately does NOT import ../slack/api — that wrapper is bound
// to ToolVault's SLACK_BOT_TOKEN, and mixing the two here would
// quietly send dispatch messages as the wrong bot. Everything below
// is self-contained and only ever uses DISPATCH_SLACK_BOT_TOKEN.
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const TYPE_LABEL = { delivery: "Material Delivery", pickup: "Tool Pickup", "tool-delivery": "Tool Delivery", misc: "Misc Task" };
const DISPATCH_TOKEN = process.env.DISPATCH_SLACK_BOT_TOKEN;

async function slackApi(method, body) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${DISPATCH_TOKEN}` },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function openDmWith(userId) {
  if (!userId || !DISPATCH_TOKEN) return null;
  try {
    const data = await slackApi("conversations.open", { users: userId });
    if (data.ok) return data.channel.id;
    console.error("[dispatch] conversations.open failed for", userId, ":", data.error);
    return null;
  } catch (e) {
    console.error("[dispatch] conversations.open error for", userId, ":", e.message);
    return null;
  }
}

function buildNewBookingModal(defaultRequester) {
  return {
    type: "modal",
    callback_id: "booking_submit",
    title: { type: "plain_text", text: "New Dispatch Request" },
    submit: { type: "plain_text", text: "Submit" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "type_block",
        label: { type: "plain_text", text: "Type" },
        element: {
          type: "static_select",
          action_id: "type_select",
          initial_option: { text: { type: "plain_text", text: "Material Delivery" }, value: "delivery" },
          options: [
            { text: { type: "plain_text", text: "Material Delivery" }, value: "delivery" },
            { text: { type: "plain_text", text: "Tool Pickup" }, value: "pickup" },
            { text: { type: "plain_text", text: "Tool Delivery" }, value: "tool-delivery" },
            { text: { type: "plain_text", text: "Misc Task" }, value: "misc" }
          ]
        }
      },
      {
        type: "input",
        block_id: "requester_block",
        label: { type: "plain_text", text: "Requested By" },
        element: { type: "plain_text_input", action_id: "requester_input", initial_value: defaultRequester || "" }
      },
      {
        type: "input",
        block_id: "site_block",
        label: { type: "plain_text", text: "Job Site" },
        element: { type: "plain_text_input", action_id: "site_input", placeholder: { type: "plain_text", text: "e.g. Grand & Fir" } }
      },
      {
        type: "input",
        block_id: "desc_block",
        label: { type: "plain_text", text: "Description" },
        element: { type: "plain_text_input", action_id: "desc_input", multiline: true, placeholder: { type: "plain_text", text: "What needs to be picked up or delivered?" } }
      },
      {
        type: "input",
        block_id: "date_block",
        label: { type: "plain_text", text: "Date" },
        element: { type: "datepicker", action_id: "date_input" }
      },
      {
        type: "input",
        block_id: "time_block",
        optional: true,
        label: { type: "plain_text", text: "Time (optional)" },
        element: { type: "timepicker", action_id: "time_input" }
      },
      {
        type: "input",
        block_id: "priority_block",
        label: { type: "plain_text", text: "Priority" },
        element: {
          type: "radio_buttons",
          action_id: "priority_select",
          initial_option: { text: { type: "plain_text", text: "Normal" }, value: "normal" },
          options: [
            { text: { type: "plain_text", text: "Urgent" }, value: "urgent" },
            { text: { type: "plain_text", text: "Normal" }, value: "normal" },
            { text: { type: "plain_text", text: "Planned" }, value: "scheduled" }
          ]
        }
      },
      {
        type: "input",
        block_id: "notes_block",
        optional: true,
        label: { type: "plain_text", text: "Notes (optional)" },
        element: { type: "plain_text_input", action_id: "notes_input", multiline: true }
      }
    ]
  };
}

function bookingCard(booking) {
  const typeLabel = TYPE_LABEL[booking.type] || booking.type;
  const typeEmoji = { delivery:"📦", pickup:"🔧", "tool-delivery":"🚚", misc:"📝" }[booking.type] || "📋";
  const priorityText = booking.priority === "urgent" ? "🚨 *URGENT*" : booking.priority === "scheduled" ? "📅 Planned" : "📋 Normal";
  return {
    text: `${typeEmoji} New booking request from ${booking.requester}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `${typeEmoji} New Dispatch Request` } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Type:*\n${typeLabel}` },
        { type: "mrkdwn", text: `*From:*\n${booking.requester}` },
        { type: "mrkdwn", text: `*Site:*\n${booking.site || "TBD"}` },
        { type: "mrkdwn", text: `*Date:*\n${booking.date}${booking.time ? " at " + booking.time : ""}` },
        { type: "mrkdwn", text: `*Priority:*\n${priorityText}` },
      ]},
      { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${booking.description}` } },
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "✅ Approve" }, style: "primary", action_id: "approve_booking", value: booking.id },
        { type: "button", text: { type: "plain_text", text: "❌ Decline" }, style: "danger", action_id: "decline_booking", value: booking.id },
        { type: "button", text: { type: "plain_text", text: "🔗 Open in Dispatch" }, url: "https://gtmann-dispatch.netlify.app/", action_id: "open_dispatch_app" },
      ]}
    ]
  };
}

// POST /slack/dispatch-interactions
router.post("/", async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch {
    return res.status(400).send("Invalid payload");
  }

  const { type, callback_id, trigger_id, user, channel, message, actions } = payload;

  // ── Global shortcut (+ menu → Shortcuts) ────────────────────
  if (type === "shortcut") {
    res.status(200).send();
    if (callback_id === "new_booking_shortcut") {
      try {
        const modal = buildNewBookingModal(user.name);
        const data = await slackApi("views.open", { trigger_id, view: modal });
        if (!data.ok) console.error("[dispatch] views.open failed:", data.error);
      } catch (err) {
        console.error("[dispatch] new_booking_shortcut error:", err.message);
      }
    }
    return;
  }

  // ── Approve / Decline button clicks ─────────────────────────
  if (type === "block_actions") {
    res.status(200).send();
    const action = actions?.[0];
    if (!action) return;

    if (action.action_id === "approve_booking" || action.action_id === "decline_booking") {
      try {
        const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync");
        const d = low(new FileSync(process.env.DB_PATH || "./data/db.json"));
        const bookingId = action.value;
        const booking = d.get("bookings").find({ id: bookingId }).value();

        if (!booking) {
          await slackApi("chat.postEphemeral", { channel: channel?.id, user: user.id, text: "⚠️ Booking not found — it may have already been deleted." });
          return;
        }
        if (booking.status !== "pending") {
          await slackApi("chat.postEphemeral", { channel: channel?.id, user: user.id, text: `ℹ️ This booking is already marked *${booking.status}* — no change made.` });
          return;
        }

        const newStatus = action.action_id === "approve_booking" ? "approved" : "declined";
        d.get("bookings").find({ id: bookingId }).assign({
          status: newStatus,
          updatedAt: new Date().toISOString(),
          approvedViaSlack: true,
        }).write();

        const typeLabel = TYPE_LABEL[booking.type] || booking.type;

        const updateData = await slackApi("chat.update", {
          channel: channel.id,
          ts: message.ts,
          text: (newStatus === "approved" ? "✅ Approved" : "❌ Declined") + ` — ${typeLabel} for ${booking.site || "TBD"}`,
          blocks: [
            { type: "section", text: { type: "mrkdwn",
              text: (newStatus === "approved" ? "✅ *Approved*" : "❌ *Declined*") +
                    ` by <@${user.id}>\n${typeLabel} for *${booking.site || "TBD"}* — ${booking.date}`
            }}
          ]
        });
        if (!updateData.ok) console.error("[dispatch] chat.update after decision failed:", updateData.error);

        const crewChannel = process.env.SLACK_MANAGER_CHANNEL_ID;
        if (crewChannel) {
          const msg = newStatus === "approved"
            ? `✅ Booking approved by Brent: ${typeLabel} for ${booking.site} on ${booking.date}`
            : `❌ Booking declined: ${typeLabel} for ${booking.site}`;
          const crewData = await slackApi("chat.postMessage", { channel: crewChannel, text: msg });
          if (!crewData.ok) console.error("[dispatch] crew notify after decision failed:", crewData.error);
        }
      } catch (err) {
        console.error("[dispatch] block_action error:", err.message);
      }
    }
    return;
  }

  // ── New Booking modal submitted ─────────────────────────────
  if (type === "view_submission" && callback_id === "booking_submit") {
    const vals = payload.view.state.values;
    const bookingType = vals.type_block?.type_select?.selected_option?.value;
    const requester = vals.requester_block?.requester_input?.value;
    const site = vals.site_block?.site_input?.value;
    const description = vals.desc_block?.desc_input?.value;
    const date = vals.date_block?.date_input?.selected_date;
    const time = vals.time_block?.time_input?.selected_time || "";
    const priority = vals.priority_block?.priority_select?.selected_option?.value;
    const notes = vals.notes_block?.notes_input?.value || "";

    if (!requester || !description || !date) {
      return res.status(200).json({
        response_action: "errors",
        errors: {
          ...(!requester && { requester_block: "Please enter who this is for." }),
          ...(!description && { desc_block: "Please describe what's needed." }),
          ...(!date && { date_block: "Please pick a date." }),
        },
      });
    }

    res.status(200).json({ response_action: "clear" });

    try {
      const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync");
      const d = low(new FileSync(process.env.DB_PATH || "./data/db.json"));
      const booking = {
        id: uid(),
        type: bookingType || "delivery",
        requester,
        site: site || "",
        description,
        date,
        time,
        priority: priority || "normal",
        notes,
        status: "pending",
        createdAt: new Date().toISOString(),
        createdViaSlack: true,
      };
      if (!d.has("bookings").value()) d.set("bookings", []).write();
      d.get("bookings").push(booking).write();

      const typeLabel = TYPE_LABEL[booking.type] || booking.type;

      const selfChannel = await openDmWith(user.id);
      if (selfChannel) {
        const confirmData = await slackApi("chat.postMessage", { channel: selfChannel, text: `✅ Booking submitted: ${typeLabel} for ${booking.site || "TBD"}` });
        if (!confirmData.ok) console.error("[dispatch] confirm DM failed:", confirmData.error);
      }

      const brentChannel = await openDmWith(process.env.BRENT_SLACK_ID);
      const dest = brentChannel || process.env.SLACK_MANAGER_CHANNEL_ID;
      if (dest) {
        const notifyData = await slackApi("chat.postMessage", { channel: dest, ...bookingCard(booking) });
        if (!notifyData.ok) console.error("[dispatch] new booking notify failed:", notifyData.error);
      }

      console.log(`✅ Booking created via Slack shortcut: ${booking.type} for ${booking.site}`);
    } catch (err) {
      console.error("[dispatch] booking_submit error:", err.message);
    }

    return;
  }

  res.status(200).send();
});

module.exports = router;
