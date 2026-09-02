// routes/smsInbound.js — Africa's Talking posts incoming SMS here
// (configure in the AT dashboard under SMS > Callback URLs > Incoming Messages)
// Fields include: from, to, text.
//
// Supported keywords, sent as free-text SMS by citizens:
//   REPORT <code> <1-5>       e.g. "REPORT P001 3" (see CATEGORY_ORDER below)
//   FOLLOW <code>             e.g. "FOLLOW P001"
//   UNFOLLOW <code>           e.g. "UNFOLLOW P001"
//   STATUS <code>             e.g. "STATUS P001" — replies with a quick summary

const express = require("express");
const router = express.Router();
const db = require("./db");
const { computeRealityCheck, summarizeForUssd } = require("./reality");
const { sendSms } = require("./sms");

const CATEGORY_ORDER = ["not_started", "ongoing", "stalled", "complete", "mismatch"];
const CATEGORY_HELP =
  "1=not started 2=ongoing 3=stalled 4=complete 5=doesn't match";

router.post("/", async (req, res) => {
  const { from, text = "" } = req.body;
  const trimmed = text.trim();
  const upper = trimmed.toUpperCase();
  const tokens = trimmed.split(/\s+/);

  try {
    if (upper.startsWith("REPORT")) {
      const code = tokens[1];
      const categoryIndex = parseInt(tokens[2], 10);
      const category = CATEGORY_ORDER[categoryIndex - 1];
      const description = tokens.slice(3).join(" ") || null;

      const project = code ? await db.getProjectByCode(code) : null;
      if (!project) {
        await sendSms(from, `AHADI: We couldn't find project "${code || ""}". Reply with the code shown on your area's project list.`);
      } else if (!category) {
        await sendSms(from, `AHADI: Please include a status. Reply REPORT ${project.code} <1-5>. ${CATEGORY_HELP}`);
      } else {
        await db.createReport({ project_id: project.id, phone: from, category, description });
        await sendSms(from, `AHADI: Thanks — your report on "${project.title}" has been recorded.`);
      }
    } else if (upper.startsWith("UNFOLLOW")) {
      const code = tokens[1];
      const project = code ? await db.getProjectByCode(code) : null;
      if (!project) {
        await sendSms(from, `AHADI: We couldn't find project "${code || ""}".`);
      } else {
        await db.unfollowProject({ phone: from, project_id: project.id });
        await sendSms(from, `AHADI: You've unfollowed "${project.title}".`);
      }
    } else if (upper.startsWith("FOLLOW")) {
      const code = tokens[1];
      const project = code ? await db.getProjectByCode(code) : null;
      if (!project) {
        await sendSms(from, `AHADI: We couldn't find project "${code || ""}". Reply with the code shown on your area's project list.`);
      } else {
        await db.followProject({ phone: from, project_id: project.id });
        await sendSms(from, `AHADI: You're now following "${project.title}" (${project.code}). We'll text you when there's an update.`);
      }
    } else if (upper.startsWith("STATUS")) {
      const code = tokens[1];
      const project = code ? await db.getProjectByCode(code) : null;
      if (!project) {
        await sendSms(from, `AHADI: We couldn't find project "${code || ""}".`);
      } else {
        const counts = await db.getReportCountsForProject(project.id);
        const realityCheck = computeRealityCheck(project, counts);
        await sendSms(from, `AHADI: "${project.title}" — ${summarizeForUssd(realityCheck)}`);
      }
    }
    // Anything else is ignored — AT just needs a 200 response either way.
  } catch (err) {
    console.error("[smsInbound.js] error:", err);
  }

  res.sendStatus(200);
});

module.exports = router;
