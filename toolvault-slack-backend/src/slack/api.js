// src/slack/api.js
// ─────────────────────────────────────────────────────────────
// Wrapper around the Slack Web API.
// Uses the bot token to post messages and open modals.
// ─────────────────────────────────────────────────────────────

const axios = require("axios");

const SLACK_API = "https://slack.com/api";

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    "Content-Type": "application/json",
  };
}

// Open a modal triggered from a slash command or button click
async function openModal(triggerId, view) {
  const res = await axios.post(
    `${SLACK_API}/views.open`,
    { trigger_id: triggerId, view },
    { headers: getHeaders() }
  );
  if (!res.data.ok) {
    console.error("views.open failed:", res.data.error);
    throw new Error(res.data.error);
  }
  return res.data;
}

// Post a message to a channel
async function postMessage(channel, payload) {
  const res = await axios.post(
    `${SLACK_API}/chat.postMessage`,
    { channel, ...payload },
    { headers: getHeaders() }
  );
  if (!res.data.ok) {
    console.error("chat.postMessage failed:", res.data.error);
  }
  return res.data;
}

// Post an ephemeral message (only visible to one user)
async function postEphemeral(channel, userId, payload) {
  const res = await axios.post(
    `${SLACK_API}/chat.postEphemeral`,
    { channel, user: userId, ...payload },
    { headers: getHeaders() }
  );
  if (!res.data.ok) {
    console.error("chat.postEphemeral failed:", res.data.error);
  }
  return res.data;
}

// Respond to a slash command's response_url (immediate reply)
async function respondToCommand(responseUrl, payload) {
  await axios.post(responseUrl, payload);
}

module.exports = { openModal, postMessage, postEphemeral, respondToCommand };
