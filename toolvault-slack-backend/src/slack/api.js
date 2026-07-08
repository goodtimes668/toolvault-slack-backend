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

// Cache resolved user-ID -> DM-channel-ID lookups for this process's
// lifetime. Avoids an extra Slack API round-trip on every message sent
// to the same person (checkout confirmations, check-in confirmations,
// error messages all post to `user.id` repeatedly).
const dmChannelCache = new Map();

// If `channel` is a raw user ID (starts with "U"), resolves it to the
// bot's OWN DM channel with that user via conversations.open. Passing a
// raw user ID straight to chat.postMessage does NOT error — Slack
// silently accepts it and routes the message into that user's DM with
// Slackbot instead of with this app. `ok: true` comes back either way,
// so this bug produces no error, no log line, nothing — the message
// just lands somewhere the recipient never thinks to check.
async function resolveChannel(channel) {
  if (!channel || channel[0] !== "U") return channel; // already a channel/group/DM id — pass through
  if (dmChannelCache.has(channel)) return dmChannelCache.get(channel);

  try {
    const res = await axios.post(
      `${SLACK_API}/conversations.open`,
      { users: channel },
      { headers: getHeaders() }
    );
    if (!res.data.ok) {
      console.error("conversations.open failed for", channel, ":", res.data.error);
      return null;
    }
    const dmId = res.data.channel.id;
    dmChannelCache.set(channel, dmId);
    return dmId;
  } catch (e) {
    console.error("conversations.open error for", channel, ":", e.message);
    return null;
  }
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

// Post a message to a channel — or to a user's DM, transparently.
// Pass either a real channel/group/DM ID (starts with C, G, or D) or a
// raw user ID (starts with U); user IDs are resolved to a real DM
// channel automatically before posting.
async function postMessage(channel, payload) {
  const resolved = await resolveChannel(channel);
  if (!resolved) {
    console.error("chat.postMessage skipped — could not resolve destination for", channel);
    return { ok: false, error: "channel_resolution_failed" };
  }
  const res = await axios.post(
    `${SLACK_API}/chat.postMessage`,
    { channel: resolved, ...payload },
    { headers: getHeaders() }
  );
  if (!res.data.ok) {
    console.error("chat.postMessage failed:", res.data.error);
  }
  return res.data;
}

// Post an ephemeral message (only visible to one user).
// `channel` here is always a real channel ID supplied by Slack itself
// (the channel a slash command or button click happened in), never a
// raw user ID we constructed — no resolution needed.
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
