// src/slack/verify.js
// ─────────────────────────────────────────────────────────────
// Verifies that incoming requests genuinely come from Slack.
// Slack signs every request with your app's signing secret.
// We compare that signature before processing anything.
// ─────────────────────────────────────────────────────────────

const crypto = require("crypto");

function verifySlackSignature(req, res, next) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not set");
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const slackSignature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];

  if (!slackSignature || !timestamp) {
    return res.status(400).json({ error: "Missing Slack headers" });
  }

  // Reject requests older than 5 minutes (replay attack prevention)
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp) < fiveMinutesAgo) {
    return res.status(400).json({ error: "Request too old" });
  }

  // Build the base string Slack uses to sign the request
  const sigBaseString = `v0:${timestamp}:${req.rawBody}`;

  // Compute our expected signature
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBaseString, "utf8")
      .digest("hex");

  // Timing-safe comparison to prevent timing attacks
  try {
    const sigBuffer = Buffer.from(mySignature, "utf8");
    const slackSigBuffer = Buffer.from(slackSignature, "utf8");

    if (
      sigBuffer.length !== slackSigBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, slackSigBuffer)
    ) {
      return res.status(401).json({ error: "Invalid signature" });
    }
  } catch {
    return res.status(401).json({ error: "Signature verification failed" });
  }

  next();
}

module.exports = { verifySlackSignature };
