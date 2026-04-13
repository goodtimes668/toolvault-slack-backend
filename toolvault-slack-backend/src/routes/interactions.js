// src/routes/interactions.js
// ─────────────────────────────────────────────────────────────
// Handles Slack interactive payloads:
//   - Modal form submissions (checkout, check-in)
//   - Button clicks from dashboard messages
// ─────────────────────────────────────────────────────────────

const express = require("express");
const router = express.Router();
const db = require("../db/store");
const slack = require("../slack/api");
const blocks = require("../slack/blocks");

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// POST /slack/interactions
router.post("/", async (req, res) => {
  let payload;
  try {
    payload = JSON.parse(req.body.payload);
  } catch {
    return res.status(400).send("Invalid payload");
  }

  const { type, callback_id, trigger_id, user, channel, actions } = payload;

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
    } catch (err) {
      console.error("block_action error:", err.message);
    }

    return;
  }

  // ── View submission (modal form) ───────────────────────────
  if (type === "view_submission") {

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

      // Validate required fields
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

      // Dismiss modal
      res.status(200).json({ response_action: "clear" });

      try {
        const tool = db.getToolById(toolId);
        if (!tool) throw new Error("Tool not found");

        // Check if tool is still available (race condition protection)
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

        // Post confirmation to the channel where the command was used
        // We post to the bot's DM with the user since we don't have channel context in modals
        const confirmation = blocks.checkoutConfirmation(tool, rental);
        await slack.postMessage(user.id, { ...confirmation, text: `✅ ${tool.name} checked out to ${checkedOutBy}` });

        // Also log to alerts
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

        // Update rental
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

        // Update tool condition
        db.updateTool(rental.toolId, {
          condition: returnCondition,
          damageFlagged,
          jobSite: damageFlagged ? tool.jobSite : "",
        });

        // Post confirmation to user
        const updatedRental = { ...rental, returnCondition, damageFlagged, damageDesc, returnNotes };
        const confirmation = blocks.checkinConfirmation(tool, updatedRental);
        await slack.postMessage(user.id, { ...confirmation, text: `${damageFlagged ? "🚩" : "✅"} ${tool.name} checked in by ${rental.checkedOutBy}` });

        // If damaged — send alert to manager channel
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

  // Default 200 for unhandled interaction types
  res.status(200).send();
});

module.exports = router;
