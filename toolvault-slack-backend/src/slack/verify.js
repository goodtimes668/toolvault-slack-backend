// src/slack/verify.js
// ─────────────────────────────────────────────────────────────
// Verifies that incoming requests genuinely come from Slack.
// Each Slack app has its OWN signing secret. Now that ToolVault
// Pro and GT Mann Dispatch are separate apps, this is a factory:
// createSlackVerifier(secret) returns middleware bound to exactly
// one app's secret. `verifySlackSignature` below still exists,
// unchanged in behavior, for ToolVault Pro's existing routes —
// nothing in server.js needs to change for those.
// ─────────────────────────────────────────────────────────────

const crypto = require("crypto");

function createSlackVerifier(signingSecret) {
  return function verifySlackSignature(req, res, next) {
    if (!signingSecret) {
      console.error("Signing secret not set for this verifier");
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

    // Compute our expected signature, using THIS verifier's secret
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
  };
}

// Existing behavior, preserved exactly: ToolVault Pro's own verifier,
// bound to its signing secret. /slack/commands and /slack/interactions
// in server.js keep using this — zero changes needed there.
const verifySlackSignature = createSlackVerifier(process.env.SLACK_SIGNING_SECRET);

module.exports = { verifySlackSignature, createSlackVerifier };
