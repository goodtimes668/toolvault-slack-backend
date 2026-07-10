// src/routes/interactions.js
// ─────────────────────────────────────────────────────────────
// Handles Slack interactive payloads:
//   - Global shortcut (lightning bolt) -> New Booking modal
//   - Modal form submissions (checkout, check-in, new booking)
//   - Button clicks from dashboard messages
//   - Button clicks from dispatch booking notifications
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const db = require("../db/store");
const slack = require("../slack/api");
const blocks = require("../slack/blocks");

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

const TYPE_LABEL = { delivery: "Material Delivery", pickup: "Tool Pickup", "tool-delivery": "Tool Delivery", misc: "Misc Task" };

// Same DM-resolution pattern already proven working in routes/api.js —
// duplicated here on purpose rather than relying on slack.postMessage's
// auto-resolution, since that fix's deployment was never confirmed.
async function openDmWith(userId, slackToken) {
  if (!userId) return null;
  try {
    const r = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${slackToken}` },
      body: JSON.stringify({ users: userId })
    });
    const data = await r.json();
    if (data.ok) return data.channel.id;
    console.error("[slack] conversations.open failed for", userId, ":", data.error);
    return null;
  } catch (e) {
    console.error("[slack] conversations.open error for", userId, ":", e.message);
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
        element: {
          type: "plain_text_input",
          action_id: "requester_input",
          initial_value: defaultRequester || ""
        }
      },
      {
        type: "input",
        block_id: "site_block",
        label: { type: "plain_text", text: "Job Site" },
        element: {
          type: "plain_text_input",
          action_id: "site_input",
          placeholder: { type: "plain_text", text: "e.g. Grand & Fir" }
        }
      },
      {
        type: "input",
        block_id: "desc_block",
        label: { type: "plain_text", text: "Description" },
        element: {
          type: "plain_text_input",
          action_id: "desc_input",
          multiline: true,
          placeholder: { type: "plain_text", text: "What needs to be picked up or delivered?" }
        }
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

// POST /slack/interactions
router.post("/", async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch {
    return res.status(400).send("Invalid payload");
  }

  const { type, callback_id, trigger_id, user, channel, message, actions } = payload;

  // ── Global shortcut (lightning bolt) ────────────────────────
  if (type === "shortcut") {
    res.status(200).send();
    if (callback_id === "new_booking_shortcut") {
      try {
        const modal = buildNewBookingModal(user.name);
        await slack.openModal(trigger_id, modal);
      } catch (err) {
        console.error("new_booking_shortcut error:", err.message);
      }
    }
    return;
  }

  // ── Block action (button click) ────────────────────────────
  if (type === "block_actions") {
    res.status(200).send();

    const action = actions?.[0];
    if (!action) return;

    try {
      if (action.action_id === "open_checkout") {
        const available = db.getAvailableTools();
        if (available.length === 0) {
          await slack.postEphemeral(channel?.id, user.id, {
            text: "⚠️ No tools are currently available for checkout.",
          });
          return;
        }
        const modal = blocks.buildCheckoutModal(available, db.getCategories());
        await slack.openModal(trigger_id, modal);
      }

      if (action.action_id === "open_checkin") {
        const active = db.getActiveRentals();
        if (active.length === 0) {
          await slack.postEphemeral(channel?.id, user.id, {
            text: "ℹ️ No tools are currently checked out.",
          });
          return;
        }
        const modal = blocks.buildCheckinModal(active, db.getAllTools());
        await slack.openModal(trigger_id, modal);
      }

      if (action.action_id === "view_rentals") {
        const rentals = db.getActiveRentals();
        const tools = db.getAllTools();
        const msgPayload = blocks.buildRentalList(rentals, tools);
        await slack.postEphemeral(channel?.id, user.id, msgPayload);
      }

      // ── Dispatch booking Approve/Decline ─────────────────
      if (action.action_id === "approve_booking" || action.action_id === "decline_booking") {
        const low = require("lowdb"); const FileSync = require("lowdb/adapters/FileSync");
        const d = low(new FileSync(process.env.DB_PATH || "./data/db.json"));
        const bookingId = action.value;
        const booking = d.get("bookings").find({ id: bookingId }).value();

        if (!booking) {
          await slack.postEphemeral(channel?.id, user.id, {
            text: "⚠️ Booking not found — it may have already been deleted.",
          });
          return;
        }

        if (booking.status !== "pending") {
          await slack.postEphemeral(channel?.id, user.id, {
            text: `ℹ️ This booking is already marked *${booking.status}* — no change made.`,
          });
          return;
        }

        const newStatus = action.action_id === "approve_booking" ? "approved" : "declined";
        d.get("bookings").find({ id: bookingId }).assign({
          status: newStatus,
          updatedAt: new Date().toISOString(),
          approvedViaSlack: true,
        }).write();

        const typeLabel = TYPE_LABEL[booking.type] || booking.type;

        try {
          const updateRes = await fetch("https://slack.com/api/chat.update", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.SLACK_BOT_TOKEN}` },
            body: JSON.stringify({
              channel: channel.id,
              ts: message.ts,
              text: (newStatus === "approved" ? "✅ Approved" : "❌ Declined") + ` — ${typeLabel} for ${booking.site || "TBD"}`,
              blocks: [
                { type: "section", text: { type: "mrkdwn",
                  text: (newStatus === "approved" ? "✅ *Approved*" : "❌ *Declined*") +
                        ` by <@${user.id}>\n${typeLabel} for *${booking.site || "TBD"}* — ${booking.date}`
                }}
              ]
            })
          });
          const updateData = await updateRes.json();
          if (!updateData.ok) console.error("[slack] chat.update after booking decision failed:", updateData.error);
        } catch (e) {
          console.error("[slack] chat.update after booking decision error:", e.message);
        }

        const crewChannel = process.env.SLACK_MANAGER_CHANNEL_ID;
        if (crewChannel) {
          const msg = newStatus === "approved"
            ? `✅ Booking approved by Brent: ${typeLabel} for ${booking.site} on ${booking.date}`
            : `❌ Booking declined: ${typeLabel} for ${booking.site}`;
          try {
            await slack.postMessage(crewChannel, { text: msg });
          } catch (e) {
            console.error("[slack] crew notify after booking decision error:", e.message);
          }
        }
      }
    } catch (err) {
      console.error("block_action error:", err.message);
    }

    return;
  }

  // ── View submission (modal form) ───────────────────────────
  if (type === "view_submission") {

    // ── New Booking Modal Submitted (from lightning-bolt shortcut) ──
    if (callback_id === "booking_submit") {
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

        const slackToken = process.env.SLACK_BOT_TOKEN;
        const typeLabel = TYPE_LABEL[booking.type] || booking.type;

        if (slackToken) {
          // Confirm to whoever submitted it, in their own DM
          const selfChannel = await openDmWith(user.id, slackToken);
          if (selfChannel) {
            const confirmRes = await fetch("https://slack.com/api/chat.postMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${slackToken}` },
              body: JSON.stringify({ channel: selfChannel, text: `✅ Booking submitted: ${typeLabel} for ${booking.site || "TBD"}` })
            });
            const confirmData = await confirmRes.json();
            if (!confirmData.ok) console.error("[slack] confirm DM (shortcut booking) failed:", confirmData.error);
          }

          // Notify Brent — same DM-resolution + card as the web app's own POST /bookings
          const brentChannel = await openDmWith(process.env.BRENT_SLACK_ID, slackToken);
          const dest = brentChannel || process.env.SLACK_MANAGER_CHANNEL_ID;
          if (dest) {
            const typeEmoji = { delivery:"📦", pickup:"🔧", "tool-delivery":"🚚", misc:"📝" }[booking.type] || "📋";
            const priorityText = booking.priority === "urgent" ? "🚨 *URGENT*" : booking.priority === "scheduled" ? "📅 Planned" : "📋 Normal";
            const notifyRes = await fetch("https://slack.com/api/chat.postMessage", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${slackToken}` },
              body: JSON.stringify({
                channel: dest,
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
                  ]}
                ]
              })
            });
            const notifyData = await notifyRes.json();
            if (!notifyData.ok) console.error("[slack] chat.postMessage (shortcut new booking) failed:", notifyData.error);
          }
        }

        console.log(`✅ Booking created via Slack shortcut: ${booking.type} for ${booking.site}`);
      } catch (err) {
        console.error("booking_submit error:", err.message);
      }

      return;
    }

    // ── Checkout Modal Submitted ────────────────────────────
    if (callback_id === "checkout_submit") {
      const vals = payload.view.state.values;

      const toolId = vals.tool_select?.tool_id?.selected_option?.value;
      const rentalType = vals.rental_type?.type?.selected_option?.value;
      const checkedOutBy = vals.recipient_name?.name?.value;
      const empOrCompany = vals.employee_or_company?.emp_company?.value || "";
      const jobSite = vals.job_site?.site?.value;
      const expectedReturn = vals.expected_return?.return_date?.selected_date;
      const checkoutCondition = vals.checkout_condition?.condition?.selected_option?.value;
      const notes = vals.notes?.notes_text?.value || "";
      const signature = vals.signature?.sig?.value;

      if (!toolId || !checkedOutBy || !jobSite || !expectedReturn || !signature) {
        return res.status(200).json({
          response_action: "errors",
          errors: {
            ...(!checkedOutBy && { recipient_name: "Please enter the recipient's full name." }),
            ...(!jobSite && { job_site: "Please enter the job site." }),
            ...(!expectedReturn && { expected_return: "Please select a return date." }),
            ...(!signature && { signature: "A digital signature is required." }),
          },
        });
      }

      res.status(200).json({ response_action: "clear" });

      try {
        const tool = db.getToolById(toolId);
        if (!tool) throw new Error("Tool not found");

        const existingRental = db.getActiveRentalForTool(toolId);
        if (existingRental) throw new Error("Tool was just checked out by someone else");

        const rental = {
          id: uid(),
          toolId,
          rentalType,
          checkedOutBy,
          [rentalType === "internal" ? "employeeId" : "company"]: empOrCompany,
          jobSite,
          checkoutDate: new Date().toISOString().split("T")[0],
          expectedReturn,
          checkoutCondition,
          notes,
          signature,
          status: "active",
          createdAt: new Date().toISOString(),
          createdBySlackUser: user.id,
          createdBySlackName: user.name,
        };

        db.addRental(rental);
        db.updateTool(toolId, { jobSite });

        const confirmation = blocks.checkoutConfirmation(tool, rental);
        await slack.postMessage(user.id, { ...confirmation, text: `✅ ${tool.name} checked out to ${checkedOutBy}` });

        db.addAlert({
          id: uid(),
          type: "checkout",
          message: `${tool.name} checked out to ${checkedOutBy} for ${jobSite}. Due: ${expectedReturn}`,
          date: new Date().toISOString(),
          read: false,
        });

        console.log(`✅ Checkout: ${tool.name} → ${checkedOutBy}`);
      } catch (err) {
        console.error("checkout_submit error:", err.message);
        await slack.postMessage(user.id, { text: `❌ Checkout failed: ${err.message}` });
      }

      return;
    }

    // ── Check-In Modal Submitted ────────────────────────────
    if (callback_id === "checkin_submit") {
      const vals = payload.view.state.values;

      const rentalId = vals.rental_select?.rental_id?.selected_option?.value;
      const returnCondition = vals.return_condition?.condition?.selected_option?.value;
      const damageFlagged = vals.damage_flagged?.damage?.selected_option?.value === "yes";
      const damageDesc = vals.damage_desc?.damage_text?.value || "";
      const returnNotes = vals.return_notes?.notes_text?.value || "";
      const signature = vals.return_signature?.sig?.value;

      if (!rentalId || !signature) {
        return res.status(200).json({
          response_action: "errors",
          errors: {
            ...(!rentalId && { rental_select: "Please select a rental." }),
            ...(!signature && { return_signature: "A return signature is required." }),
          },
        });
      }

      if (damageFlagged && !damageDesc) {
        return res.status(200).json({
          response_action: "errors",
          errors: { damage_desc: "Please describe the damage." },
        });
      }

      res.status(200).json({ response_action: "clear" });

      try {
        const rental = db.getRentalById(rentalId);
        if (!rental) throw new Error("Rental not found");

        const tool = db.getToolById(rental.toolId);
        if (!tool) throw new Error("Tool not found");

        db.updateRental(rentalId, {
          status: "returned",
          returnDate: new Date().toISOString(),
          returnCondition,
          damageFlagged,
          damageDesc,
          returnNotes,
          returnSignature: signature,
          returnedBySlackUser: user.id,
        });

        db.updateTool(rental.toolId, {
          condition: returnCondition,
          damageFlagged,
          jobSite: damageFlagged ? tool.jobSite : "",
        });

        const updatedRental = { ...rental, returnCondition, damageFlagged, damageDesc, returnNotes };
        const confirmation = blocks.checkinConfirmation(tool, updatedRental);
        await slack.postMessage(user.id, { ...confirmation, text: `${damageFlagged ? "🚩" : "✅"} ${tool.name} checked in by ${rental.checkedOutBy}` });

        if (damageFlagged) {
          const managerChannel = process.env.SLACK_MANAGER_CHANNEL_ID;
          if (managerChannel) {
            const alertPayload = blocks.damageAlert(tool, updatedRental);
            await slack.postMessage(managerChannel, { ...alertPayload, text: `🚨 Damage Alert: ${tool.name}` });
          }

          db.addAlert({
            id: uid(),
            type: "damage",
            message: `${tool.name} returned with damage by ${rental.checkedOutBy}. ${damageDesc}`,
            date: new Date().toISOString(),
            read: false,
          });
        }

        db.addAlert({
          id: uid(),
          type: "checkin",
          message: `${tool.name} checked in by ${rental.checkedOutBy}. Condition: ${returnCondition}.`,
          date: new Date().toISOString(),
          read: false,
        });

        console.log(`✅ Check-in: ${tool.name} from ${rental.checkedOutBy}${damageFlagged ? " — DAMAGED" : ""}`);
      } catch (err) {
        console.error("checkin_submit error:", err.message);
        await slack.postMessage(user.id, { text: `❌ Check-in failed: ${err.message}` });
      }

      return;
    }
  }

  res.status(200).send();
});

module.exports = router;
