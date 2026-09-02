// routes/ussd.js — AHADI USSD menu (spec section 17)
//
//   *XXX#
//   AHADI
//   1. My area
//   2. View promises
//   3. Check project
//   4. Report progress
//   5. Follow project
//
// Design note: the spec's demo data is deliberately scoped to one
// constituency (section 20), so "My area" drills down to ward only —
// a full county > constituency > ward chain would burn USSD screens
// for no real benefit at this scale. If you load multi-county data later,
// extend resolveDefaultLocation() below into a proper drill-down.

const express = require("express");
const router = express.Router();
const db = require("./db");
const { computeRealityCheck, summarizeForUssd } = require("./reality");
const { sendSms } = require("./sms");

const userSessions = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of userSessions.entries()) {
    if (now - session.lastActive > 3600000) userSessions.delete(phone);
  }
}, 3600000);

// Report category menu — order matches spec section 9 exactly.
const CATEGORY_ORDER = ["not_started", "ongoing", "stalled", "complete", "mismatch"];
const CATEGORY_MENU =
  "CON What is happening?\n" +
  "1. Work has not started\n" +
  "2. Work is ongoing\n" +
  "3. Work has stalled\n" +
  "4. Project appears complete\n" +
  "5. Something doesn't match";

function statusIcon(status, deadline) {
  const s = (status || "").toLowerCase();
  const deadlinePassed = deadline ? new Date(deadline) < new Date() : false;
  if (s === "completed") return "🟢";
  if (s === "delayed" || (deadlinePassed && s !== "completed")) return "🔴";
  return "🟡";
}

function money(n) {
  const v = Number(n) || 0;
  if (v >= 1000000) return `KSh ${(v / 1000000).toFixed(v % 1000000 === 0 ? 0 : 1)}M`;
  if (v >= 1000) return `KSh ${(v / 1000).toFixed(0)}K`;
  return `KSh ${v}`;
}

function renderProjectListMenu(projects) {
  if (projects.length === 0) return "No tracked projects found for this area yet.";
  const lines = projects
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${statusIcon(p.official_status, p.expected_completion)} ${p.title}`);
  return lines.join("\n");
}

async function renderProjectDetail(project) {
  const counts = await db.getReportCountsForProject(project.id);
  const realityCheck = computeRealityCheck(project, counts);
  const promise = project.promises || {};

  let out = `${project.title} [${project.code}]\n`;
  out += `${project.ward || ""}\n`;
  out += `Promised: ${promise.deadline || "N/A"}\n`;
  out += `Funded: ${money(project.budget)}\n`;
  out += `Status: ${(project.official_status || "unknown").replace("_", " ")}\n`;
  out += summarizeForUssd(realityCheck);

  return out;
}

async function resolveDefaultArea(session) {
  if (session.data.area) return session.data.area;
  const area = await db.getDefaultArea();
  if (area) session.data.area = area;
  return area;
}

async function submitReport({ project_id, phone, categoryIndex, description }) {
  const category = CATEGORY_ORDER[categoryIndex - 1];
  if (!category) return null;
  return db.createReport({ project_id, phone, category, description });
}

router.post("/", async (req, res) => {
  const { phoneNumber, text = "" } = req.body;
  const normalizedPhone = (phoneNumber || "").replace(/\s/g, "");
  const parts = text.split("*").filter((p) => p !== "");
  let response = "";

  console.log(`[USSD] Phone: ${normalizedPhone}, Text: ${text}, Parts:`, parts);

  try {
    if (!userSessions.has(normalizedPhone)) {
      userSessions.set(normalizedPhone, { step: 0, data: {}, lastActive: Date.now() });
    }
    const session = userSessions.get(normalizedPhone);
    session.lastActive = Date.now();

    // MAIN MENU
    if (parts.length === 0) {
      session.data = {};
      response =
        "CON AHADI\nPromised. Funded. Delivered?\n" +
        "1. My area\n2. View promises\n3. Check project\n4. Report progress\n5. Follow project";
    }

    // ------------------------------------------------------------------
    // FLOW 1: MY AREA — pick a ward, see the summary, drill into projects
    // ------------------------------------------------------------------
    else if (parts[0] === "1" && parts.length === 1) {
      const area = await db.getDefaultArea();
      const wards = area ? await db.getWards(area.county, area.constituency) : [];
      if (wards.length === 0) {
        response = "END No areas are being tracked yet. Please check back soon.";
        userSessions.delete(normalizedPhone);
      } else {
        session.data.wardOptions = wards;
        session.data.baseArea = { county: area.county, constituency: area.constituency };
        response = `CON Choose your ward\n${wards.slice(0, 5).map((w, i) => `${i + 1}. ${w}`).join("\n")}`;
      }
    } else if (parts[0] === "1" && parts.length === 2) {
      const idx = parseInt(parts[1], 10) - 1;
      const wards = session.data.wardOptions || [];
      const ward = wards[idx];
      if (!ward) {
        response = "END Invalid ward selection. Please try again.";
        userSessions.delete(normalizedPhone);
      } else {
        const area = { ...session.data.baseArea, ward };
        session.data.area = area;
        const summary = await db.getAreaSummary(area);
        response =
          `CON ${ward}\n` +
          `${summary.tracked} tracked promises\n` +
          `${money(summary.totalAllocated)} allocated\n` +
          `🟢${summary.onTrack} 🟡${summary.needsAttention} 🔴${summary.delayed}\n` +
          `1. View promises here\n0. Main menu\n99. Exit`;
      }
    } else if (parts[0] === "1" && parts.length === 3) {
      const choice = parts[2];
      if (choice === "0") {
        session.data = {};
        response =
          "CON AHADI\nPromised. Funded. Delivered?\n" +
          "1. My area\n2. View promises\n3. Check project\n4. Report progress\n5. Follow project";
      } else if (choice === "99") {
        response = "END Thanks for using Ahadi.";
        userSessions.delete(normalizedPhone);
      } else if (choice === "1") {
        const projects = await db.getProjectsForArea(session.data.area, 5);
        session.data.projectList = projects;
        response = `CON ${session.data.area.ward}\n${renderProjectListMenu(projects)}\n0. Main menu\n99. Exit`;
      } else {
        response = "END Invalid option. Please try again.";
        userSessions.delete(normalizedPhone);
      }
    } else if (parts[0] === "1" && parts.length === 4) {
      const choice = parts[3];
      if (choice === "0") {
        session.data = {};
        response = "END Dial in again anytime.";
        userSessions.delete(normalizedPhone);
      } else if (choice === "99") {
        response = "END Thanks for using Ahadi.";
        userSessions.delete(normalizedPhone);
      } else {
        const projects = session.data.projectList || [];
        const project = projects[parseInt(choice, 10) - 1];
        if (!project) {
          response = "END Invalid selection. Please try again.";
          userSessions.delete(normalizedPhone);
        } else {
          const full = await db.getProjectById(project.id);
          session.data.selectedProject = full;
          const detail = await renderProjectDetail(full);
          response = `CON ${detail}\n1. Report progress\n2. Follow project\n0. Main menu\n99. Exit`;
        }
      }
    } else if (parts[0] === "1" && parts.length === 5) {
      response = await handleProjectAction(session, parts[4], normalizedPhone);
      if (response.startsWith("END")) userSessions.delete(normalizedPhone);
    } else if (parts[0] === "1" && parts.length === 6) {
      // Report category selection nested under the "My area" browse flow.
      const catIdx = parseInt(parts[5], 10);
      response = await handleReportSubmit(session, catIdx, normalizedPhone);
      userSessions.delete(normalizedPhone);
    }

    // ------------------------------------------------------------------
    // FLOW 2: VIEW PROMISES — shortcut straight to the project list,
    // using the last selected area or falling back to the default demo area
    // ------------------------------------------------------------------
    else if (parts[0] === "2" && parts.length === 1) {
      const area = await resolveDefaultArea(session);
      if (!area) {
        response = "END No promises are being tracked yet. Please check back soon.";
        userSessions.delete(normalizedPhone);
      } else {
        const projects = await db.getProjectsForArea(area, 5);
        session.data.projectList = projects;
        response = `CON ${area.ward}\n${renderProjectListMenu(projects)}\n0. Main menu\n99. Exit`;
      }
    } else if (parts[0] === "2" && parts.length === 2) {
      const choice = parts[1];
      if (choice === "0") {
        session.data = {};
        response = "END Dial in again anytime.";
        userSessions.delete(normalizedPhone);
      } else if (choice === "99") {
        response = "END Thanks for using Ahadi.";
        userSessions.delete(normalizedPhone);
      } else {
        const projects = session.data.projectList || [];
        const project = projects[parseInt(choice, 10) - 1];
        if (!project) {
          response = "END Invalid selection. Please try again.";
          userSessions.delete(normalizedPhone);
        } else {
          const full = await db.getProjectById(project.id);
          session.data.selectedProject = full;
          const detail = await renderProjectDetail(full);
          response = `CON ${detail}\n1. Report progress\n2. Follow project\n0. Main menu\n99. Exit`;
        }
      }
    } else if (parts[0] === "2" && parts.length === 3) {
      response = await handleProjectAction(session, parts[2], normalizedPhone);
      if (response.startsWith("END")) userSessions.delete(normalizedPhone);
    } else if (parts[0] === "2" && parts.length === 4) {
      const catIdx = parseInt(parts[3], 10);
      response = await handleReportSubmit(session, catIdx, normalizedPhone);
      userSessions.delete(normalizedPhone);
    }

    // ------------------------------------------------------------------
    // FLOW 3: CHECK PROJECT — direct lookup by code (e.g. from a flyer)
    // ------------------------------------------------------------------
    else if (parts[0] === "3" && parts.length === 1) {
      response = "CON Enter the project code\n(e.g. P001)";
    } else if (parts[0] === "3" && parts.length === 2) {
      const project = await db.getProjectByCode(parts[1]);
      if (!project) {
        response = "END No project found with that code. Check the code and try again.";
        userSessions.delete(normalizedPhone);
      } else {
        session.data.selectedProject = project;
        const detail = await renderProjectDetail(project);
        response = `CON ${detail}\n1. Report progress\n2. Follow project\n0. Main menu\n99. Exit`;
      }
    } else if (parts[0] === "3" && parts.length === 3) {
      response = await handleProjectAction(session, parts[2], normalizedPhone);
      if (response.startsWith("END")) userSessions.delete(normalizedPhone);
    } else if (parts[0] === "3" && parts.length === 4) {
      const catIdx = parseInt(parts[3], 10);
      response = await handleReportSubmit(session, catIdx, normalizedPhone);
      userSessions.delete(normalizedPhone);
    }

    // ------------------------------------------------------------------
    // FLOW 4: REPORT PROGRESS — direct shortcut, code then category
    // ------------------------------------------------------------------
    else if (parts[0] === "4" && parts.length === 1) {
      response = "CON Enter the project code\n(e.g. P001)";
    } else if (parts[0] === "4" && parts.length === 2) {
      const project = await db.getProjectByCode(parts[1]);
      if (!project) {
        response = "END No project found with that code. Check the code and try again.";
        userSessions.delete(normalizedPhone);
      } else {
        session.data.selectedProject = project;
        response = CATEGORY_MENU;
      }
    } else if (parts[0] === "4" && parts.length === 3) {
      const catIdx = parseInt(parts[2], 10);
      response = await handleReportSubmit(session, catIdx, normalizedPhone);
      userSessions.delete(normalizedPhone);
    }

    // ------------------------------------------------------------------
    // FLOW 5: FOLLOW PROJECT — direct shortcut, code then confirm
    // ------------------------------------------------------------------
    else if (parts[0] === "5" && parts.length === 1) {
      response = "CON Enter the project code\n(e.g. P001)";
    } else if (parts[0] === "5" && parts.length === 2) {
      const project = await db.getProjectByCode(parts[1]);
      if (!project) {
        response = "END No project found with that code. Check the code and try again.";
        userSessions.delete(normalizedPhone);
      } else {
        await db.followProject({ phone: normalizedPhone, project_id: project.id });
        response = `END You're now following "${project.title}". You'll get an SMS when there's an update.`;
        sendSms(
          normalizedPhone,
          `AHADI: You're now following "${project.title}" (${project.code}). We'll text you when there's an update.`
        ).catch((e) => console.error("[USSD] follow SMS failed:", e.message));
      }
      userSessions.delete(normalizedPhone);
    } else if (!response) {
      response = "END Invalid option. Please try again.";
      userSessions.delete(normalizedPhone);
    }
  } catch (err) {
    console.error("[ussd.js] error:", err);
    response = "END Sorry, something went wrong. Please try again shortly.";
    userSessions.delete(normalizedPhone);
  }

  res.set("Content-Type", "text/plain");
  res.send(response);
});

// Shared submenu handler for "1. Report progress / 2. Follow project" that
// appears after any project detail screen, regardless of which flow got you there.
async function handleProjectAction(session, choice, phone) {
  const project = session.data.selectedProject;
  if (!project) return "END Session expired. Please dial in again.";

  if (choice === "0") {
    return "END Dial in again anytime.";
  }
  if (choice === "99") {
    return "END Thanks for using Ahadi.";
  }
  if (choice === "1") {
    return CATEGORY_MENU;
  }
  if (choice === "2") {
    await db.followProject({ phone, project_id: project.id });
    sendSms(
      phone,
      `AHADI: You're now following "${project.title}" (${project.code}). We'll text you when there's an update.`
    ).catch((e) => console.error("[USSD] follow SMS failed:", e.message));
    return `END You're now following "${project.title}". You'll get an SMS when there's an update.`;
  }
  return "END Invalid option. Please try again.";
}

async function handleReportSubmit(session, categoryIndex, phone) {
  const project = session.data.selectedProject;
  if (!project) return "END Session expired. Please dial in again.";
  if (!CATEGORY_ORDER[categoryIndex - 1]) return "END Invalid option. Please try again.";

  try {
    await submitReport({ project_id: project.id, phone, categoryIndex });
    return `END Thanks — your report on "${project.title}" has been recorded. This helps keep the promise accountable.`;
  } catch (err) {
    console.error("[USSD] report submit error:", err);
    return "END Sorry, we couldn't save your report. Please try again.";
  }
}

module.exports = router;
