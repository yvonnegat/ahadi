const express = require("express");
const axios = require("axios");
const multer = require("multer");
const router = express.Router();
const db = require("./db");
const { computeRealityCheck } = require("./reality");

// Reports arrive as multipart/form-data now (to carry an optional photo).
// memoryStorage keeps the file as a buffer — nothing touches local disk —
// and it's handed straight to Supabase Storage in db.uploadReportPhoto.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed"));
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// LOCATIONS — powers the county/constituency/ward dropdowns on the dashboard
// ---------------------------------------------------------------------------

router.get("/locations/counties", async (req, res) => {
  res.json({ counties: await db.getCounties() });
});

router.get("/locations/constituencies", async (req, res) => {
  const { county } = req.query;
  if (!county) return res.status(400).json({ error: "county is required" });
  res.json({ constituencies: await db.getConstituencies(county) });
});

router.get("/locations/wards", async (req, res) => {
  const { county, constituency } = req.query;
  if (!county || !constituency) return res.status(400).json({ error: "county and constituency are required" });
  res.json({ wards: await db.getWards(county, constituency) });
});

// ---------------------------------------------------------------------------
// AREA SUMMARY — the "Your Area" stat block (spec section 6)
// ---------------------------------------------------------------------------

router.get("/area-summary", async (req, res) => {
  const { county, constituency, ward } = req.query;
  try {
    const summary = await db.getAreaSummary({ county, constituency, ward });
    res.json({ summary });
  } catch (err) {
    console.error("[api.js] area-summary error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/overview -> the county-wide "front door" view: totals across
// every tracked area, a ward leaderboard, and the most-flagged case files —
// usable before anyone has picked a location.
router.get("/overview", async (req, res) => {
  try {
    const [totals, wardLeaderboard, mostFlagged] = await Promise.all([
      db.getAreaSummary({}),
      db.getWardLeaderboard(),
      db.getMostFlaggedProjects(6),
    ]);
    res.json({ totals, wardLeaderboard, mostFlagged });
  } catch (err) {
    console.error("[api.js] overview error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/area-summary/charts?county=&constituency=&ward= -> data for the
// dashboard's "Charts & Trends" panel: allocation by sector, and weekly
// citizen-report volume by category.
router.get("/area-summary/charts", async (req, res) => {
  const { county, constituency, ward } = req.query;
  try {
    const [budgetBySector, reportsTrend] = await Promise.all([
      db.getBudgetBySector({ county, constituency, ward }),
      db.getReportsTrend({ county, constituency, ward }, 8),
    ]);
    res.json({ budgetBySector, reportsTrend });
  } catch (err) {
    console.error("[api.js] area-summary/charts error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PROMISES / PROJECTS
// ---------------------------------------------------------------------------

// GET /api/promises?county=&constituency=&ward= -> promise cards (spec section 7)
router.get("/promises", async (req, res) => {
  const { county, constituency, ward } = req.query;
  try {
    const projects = await db.getProjectsForArea({ county, constituency, ward }, 50);
    res.json({ projects });
  } catch (err) {
    console.error("[api.js] promises error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/promises/:id -> full detail page: Promised / Funded / Reality (spec section 8)
router.get("/promises/:id", async (req, res) => {
  try {
    const project = await db.getProjectById(req.params.id);
    if (!project) return res.status(404).json({ error: "project not found" });

    const [counts, recentReports, statusHistory] = await Promise.all([
      db.getReportCountsForProject(project.id),
      db.getRecentReports(project.id, 10),
      db.getProjectUpdates(project.id),
    ]);
    const realityCheck = computeRealityCheck(project, counts);

    res.json({ project, realityCheck, recentReports, statusHistory });
  } catch (err) {
    console.error("[api.js] promise detail error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/promises/code/:code -> same as above, but for USSD-style short codes
router.get("/promises/code/:code", async (req, res) => {
  try {
    const project = await db.getProjectByCode(req.params.code);
    if (!project) return res.status(404).json({ error: "project not found" });

    const [counts, recentReports, statusHistory] = await Promise.all([
      db.getReportCountsForProject(project.id),
      db.getRecentReports(project.id, 10),
      db.getProjectUpdates(project.id),
    ]);
    const realityCheck = computeRealityCheck(project, counts);

    res.json({ project, realityCheck, recentReports, statusHistory });
  } catch (err) {
    console.error("[api.js] promise detail by code error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/promises/:id/updates  { status, source?, description?, date? }
// Logs a new official status-history entry and keeps the case file's current
// status in sync. No auth on this yet — anyone with the API can post an
// update, which is fine for a demo but needs an admin check before this
// goes anywhere near real government data.
router.post("/promises/:id/updates", async (req, res) => {
  const { status, source, description, date } = req.body;
  if (!db.VALID_PROJECT_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${db.VALID_PROJECT_STATUSES.join(", ")}` });
  }
  try {
    const update = await db.createProjectUpdate({ project_id: req.params.id, status, source, description, date });
    res.json({ update });
  } catch (err) {
    console.error("[api.js] create project update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// CITIZEN EVIDENCE (spec sections 9-10)
// ---------------------------------------------------------------------------

// POST /api/promises/:id/reports  multipart/form-data: phone?, category, description?, photo?, latitude?, longitude?
router.post("/promises/:id/reports", upload.single("photo"), async (req, res) => {
  const { phone, category, description, latitude, longitude } = req.body;
  if (!db.VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `category must be one of: ${db.VALID_CATEGORIES.join(", ")}` });
  }
  try {
    let photo_url = null;
    if (req.file) {
      photo_url = await db.uploadReportPhoto(req.file, req.params.id);
    }
    const report = await db.createReport({
      project_id: req.params.id,
      phone,
      category,
      description,
      photo_url,
      latitude: latitude ? Number(latitude) : undefined,
      longitude: longitude ? Number(longitude) : undefined,
    });
    res.json({ report });
  } catch (err) {
    console.error("[api.js] create report error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/promises/:id/follow  { phone }
router.post("/promises/:id/follow", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "phone is required" });
  try {
    const follow = await db.followProject({ phone, project_id: req.params.id });
    res.json({ follow });
  } catch (err) {
    console.error("[api.js] follow error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// AI PROMISE EXTRACTOR (spec sections 11 & 15) — the demo "wow moment"
//
// Supports two providers, switched with AI_PROVIDER in .env:
//   "groq"      (default) — free tier, no credit card, good enough for
//               structured extraction like this. Get a key at console.groq.com.
//   "anthropic" — paid, higher quality on ambiguous/messy source text.
// ---------------------------------------------------------------------------

const EXTRACTOR_SYSTEM_PROMPT = `You extract structured data about a Kenyan government project or public commitment from ANY kind of public-facing text: a speech excerpt, a manifesto line, a county development plan entry, a procurement/tender notice, a project fact sheet, a press release, or a budget line item.

The text does NOT need to use promise language like "will construct" — a formally announced, funded, or awarded government project is itself the underlying public commitment, and should be extracted the same way as a spoken promise. Fact-sheet style text (e.g. "Project Name: ... / Location: ... / Status: ... / Contract Sum: ...") is a valid, common input format — extract from its labelled fields directly.

Read the text and return ONLY a JSON object (no markdown fences, no commentary) with this exact shape:
{
  "who": string,          // implementing agency, ministry, parastatal, or government level, e.g. "Kenya Medical Supplies Authority (KEMSA)", "County Government", or "Unknown" if truly not stated or inferable
  "action": string,       // a short verb inferred from the scope of work, e.g. "construct", "renovate", "equip", "supply"
  "project": string,      // the project's name or short title, as stated
  "location": string,     // county/constituency/ward mentioned, or "Unknown" if not stated
  "deadline": string,     // a stated completion date, contract date, or target year, or "Unknown" if not stated
  "sector": string,       // one of: healthcare, education, water, roads, energy, security, agriculture, other
  "budget": number        // the funded amount / contract sum as a plain number, no currency symbol or commas (e.g. 3079998859.50), or 0 if no figure is stated
}
Only set "action" to "none" (and the rest to "Unknown"/0) if the text contains no identifiable government project or commitment at all — e.g. pure opinion, unrelated news, or spam. A structured project notice, tender award, or fact sheet naming a project and an implementing body counts as a commitment even with no narrative "promise" phrasing.`;

function extractJson(rawText) {
  const cleaned = rawText.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

async function extractWithGroq(text) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not set on the server. Get a free key at console.groq.com and add it to your .env.");
  }
  // Groq deprecates models fairly often (their whole llama-3.x chat line was
  // retired) — check https://console.groq.com/docs/models if this 404s.
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: EXTRACTOR_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "content-type": "application/json",
      },
      timeout: 20000,
    }
  );

  const raw = response.data.choices?.[0]?.message?.content;
  if (!raw) throw new Error("No text response from model");
  return extractJson(raw);
}

async function extractWithAnthropic(text) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set on the server. Add it to your .env to use the Anthropic provider.");
  }
  // Check platform.claude.com/docs for the current model name before deploying —
  // this defaults to a recent Sonnet model but that can change over time.
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model,
      max_tokens: 500,
      system: EXTRACTOR_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    },
    {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      timeout: 20000,
    }
  );

  const textBlock = (response.data.content || []).find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text response from model");
  return extractJson(textBlock.text);
}

// POST /api/promises/extract  { text }
router.post("/promises/extract", async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: "text is required" });

  const provider = (process.env.AI_PROVIDER || "groq").toLowerCase();

  try {
    const extracted = provider === "anthropic" ? await extractWithAnthropic(text) : await extractWithGroq(text);
    res.json({ extracted, provider });
  } catch (err) {
    const groqCode = err.response?.data?.error?.code;
    console.error(`[api.js] extract error (${provider}):`, err.response?.data || err.message);
    if (groqCode === "model_not_found") {
      return res.status(500).json({
        error: `The model "${process.env.GROQ_MODEL || "openai/gpt-oss-120b"}" isn't available on Groq right now. Check https://console.groq.com/docs/models for a current model ID and update GROQ_MODEL in your .env.`,
      });
    }
    res.status(500).json({ error: err.response?.data?.error?.message || err.message || "Extraction failed. Please try again or edit the fields manually." });
  }
});

// POST /api/promises  -> "Add to Ahadi" (spec section 15), creates the promise + project
// { title, description, promised_by, sector, county, constituency, ward, deadline, source_text, budget }
router.post("/promises", async (req, res) => {
  const {
    title,
    description,
    promised_by,
    sector,
    county,
    constituency,
    ward,
    deadline,
    source_text,
    source_url,
    budget,
  } = req.body;

  if (!title || !ward) return res.status(400).json({ error: "title and ward are required" });

  try {
    const { promise, project } = await db.createPromiseAndProject(
      { title, description, promised_by, sector, county, constituency, ward, deadline, source_text, source_url },
      { title, budget: budget || 0, county, constituency, ward, official_status: "not_started" }
    );
    res.json({ promise, project });
  } catch (err) {
    console.error("[api.js] create promise error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;