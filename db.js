// db.js — Ahadi data-access layer (Supabase)
const { createClient } = require("@supabase/supabase-js");
const { computeRealityCheck } = require("./reality");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ Missing Supabase credentials in .env file");
  console.error("Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

console.log("✅ Connecting to Supabase with SERVICE ROLE...");
console.log(`📡 URL: ${supabaseUrl}`);

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isValidUUID(uuid) {
  if (!uuid) return false;
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return re.test(String(uuid));
}

// ---------------------------------------------------------------------------
// LOCATIONS — distinct county/constituency/ward drawn straight from the
// projects table, so USSD navigation always matches whatever demo data you've
// loaded (per spec section 20, this will just be one constituency for now).
// ---------------------------------------------------------------------------

async function getCounties() {
  const { data, error } = await supabase.from("projects").select("county");
  if (error) {
    console.error("[DB] getCounties error:", error);
    return [];
  }
  return [...new Set((data || []).map((r) => r.county).filter(Boolean))].sort();
}

async function getConstituencies(county) {
  const { data, error } = await supabase
    .from("projects")
    .select("constituency")
    .eq("county", county);
  if (error) {
    console.error("[DB] getConstituencies error:", error);
    return [];
  }
  return [...new Set((data || []).map((r) => r.constituency).filter(Boolean))].sort();
}

async function getWards(county, constituency) {
  const { data, error } = await supabase
    .from("projects")
    .select("ward")
    .eq("county", county)
    .eq("constituency", constituency);
  if (error) {
    console.error("[DB] getWards error:", error);
    return [];
  }
  return [...new Set((data || []).map((r) => r.ward).filter(Boolean))].sort();
}

// Fallback used when a citizen jumps straight to "View promises" or "Check
// project" without picking a location first — grabs whatever ward has the
// most tracked projects so the demo always has something to show.
async function getDefaultArea() {
  const { data, error } = await supabase
    .from("projects")
    .select("county, constituency, ward")
    .limit(1);
  if (error || !data || data.length === 0) {
    console.error("[DB] getDefaultArea error:", error);
    return null;
  }
  return data[0];
}

// ---------------------------------------------------------------------------
// AREA SUMMARY — the "Your Area" stat block (spec section 6)
// ---------------------------------------------------------------------------

async function getAreaSummary({ county, constituency, ward }) {
  let query = supabase.from("projects").select("id, budget, official_status, expected_completion");
  if (county) query = query.eq("county", county);
  if (constituency) query = query.eq("constituency", constituency);
  if (ward) query = query.eq("ward", ward);

  const { data, error } = await query;
  if (error) {
    console.error("[DB] getAreaSummary error:", error);
    return { tracked: 0, totalAllocated: 0, onTrack: 0, delayed: 0, needsAttention: 0 };
  }

  const projects = data || [];
  const now = new Date();
  let onTrack = 0;
  let delayed = 0;
  let needsAttention = 0;

  for (const p of projects) {
    const status = (p.official_status || "").toLowerCase();
    const deadlinePassed = p.expected_completion ? new Date(p.expected_completion) < now : false;
    if (status === "completed" || (status === "ongoing" && !deadlinePassed)) onTrack++;
    else if (status === "delayed" || (deadlinePassed && status !== "completed")) delayed++;
    else needsAttention++;
  }

  const totalAllocated = projects.reduce((sum, p) => sum + (Number(p.budget) || 0), 0);

  return { tracked: projects.length, totalAllocated, onTrack, delayed, needsAttention };
}

// Ranks every ward by on-track rate — the county-wide "front door" view so a
// visitor who doesn't know their ward yet still sees something meaningful.
// Aggregation happens in JS (not SQL group-by) for the same reason as the
// rest of this hackathon-scale MVP: simplicity over performance at this scale.
async function getWardLeaderboard() {
  const { data, error } = await supabase
    .from("projects")
    .select("county, constituency, ward, budget, official_status, expected_completion");
  if (error) {
    console.error("[DB] getWardLeaderboard error:", error);
    return [];
  }

  const now = new Date();
  const byWard = {};
  for (const p of data || []) {
    const key = `${p.county}|${p.constituency}|${p.ward}`;
    if (!byWard[key]) {
      byWard[key] = {
        county: p.county, constituency: p.constituency, ward: p.ward,
        tracked: 0, totalAllocated: 0, onTrack: 0, delayed: 0, needsAttention: 0,
      };
    }
    const bucket = byWard[key];
    bucket.tracked++;
    bucket.totalAllocated += Number(p.budget) || 0;

    const status = (p.official_status || "").toLowerCase();
    const deadlinePassed = p.expected_completion ? new Date(p.expected_completion) < now : false;
    if (status === "completed" || (status === "ongoing" && !deadlinePassed)) bucket.onTrack++;
    else if (status === "delayed" || (deadlinePassed && status !== "completed")) bucket.delayed++;
    else bucket.needsAttention++;
  }

  return Object.values(byWard)
    .map((w) => ({ ...w, onTrackRate: w.tracked ? w.onTrack / w.tracked : 0 }))
    .sort((a, b) => a.onTrackRate - b.onTrackRate);
}

// Surfaces the case files with the strongest evidence of a discrepancy,
// across every ward — the "what needs attention right now" list for
// journalists and researchers who don't have a specific area in mind yet.
async function getMostFlaggedProjects(limit = 6) {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, code, title, ward, official_status, expected_completion");
  if (error) {
    console.error("[DB] getMostFlaggedProjects (projects) error:", error);
    return [];
  }

  const results = [];
  for (const project of projects || []) {
    const counts = await getReportCountsForProject(project.id);
    const realityCheck = computeRealityCheck(project, counts);
    if (realityCheck.flags.length > 0) {
      results.push({
        id: project.id,
        code: project.code,
        title: project.title,
        ward: project.ward,
        flagCount: realityCheck.flags.length,
        topFlag: realityCheck.flags[0].message,
        total: realityCheck.total,
      });
    }
  }

  return results
    .sort((a, b) => b.flagCount - a.flagCount || b.total - a.total)
    .slice(0, limit);
}

// Budget allocated per sector for an area — powers the "Allocation by sector"
// bar chart. Sector lives on `promises`, not `projects`, so this joins across.
async function getBudgetBySector({ county, constituency, ward }) {
  let query = supabase.from("projects").select("budget, promises:promise_id (sector)");
  if (county) query = query.eq("county", county);
  if (constituency) query = query.eq("constituency", constituency);
  if (ward) query = query.eq("ward", ward);

  const { data, error } = await query;
  if (error) {
    console.error("[DB] getBudgetBySector error:", error);
    return [];
  }

  const totals = {};
  for (const row of data || []) {
    const sector = row.promises?.sector || "other";
    totals[sector] = (totals[sector] || 0) + (Number(row.budget) || 0);
  }
  return Object.entries(totals)
    .map(([sector, total]) => ({ sector, total }))
    .sort((a, b) => b.total - a.total);
}

// Weekly citizen-report volume for an area, broken down by category —
// powers the "Reports over time" trend chart. Kept simple (fetch + bucket in
// JS) rather than a SQL window function, consistent with the rest of this
// hackathon-scale MVP.
async function getReportsTrend({ county, constituency, ward }, weeks = 8) {
  let projectQuery = supabase.from("projects").select("id");
  if (county) projectQuery = projectQuery.eq("county", county);
  if (constituency) projectQuery = projectQuery.eq("constituency", constituency);
  if (ward) projectQuery = projectQuery.eq("ward", ward);

  const { data: projects, error: projectErr } = await projectQuery;
  if (projectErr) {
    console.error("[DB] getReportsTrend (projects) error:", projectErr);
    return [];
  }
  const ids = (projects || []).map((p) => p.id);
  if (ids.length === 0) return [];

  const since = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);
  const { data: reports, error: reportsErr } = await supabase
    .from("reports")
    .select("category, created_at")
    .in("project_id", ids)
    .gte("created_at", since.toISOString());
  if (reportsErr) {
    console.error("[DB] getReportsTrend (reports) error:", reportsErr);
    return [];
  }

  // Build empty weekly buckets first so weeks with zero reports still show.
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(since.getTime() + (weeks - 1 - i) * 7 * 24 * 60 * 60 * 1000);
    buckets.push({
      weekStart: start,
      label: start.toLocaleDateString("en-KE", { month: "short", day: "numeric" }),
      not_started: 0, ongoing: 0, stalled: 0, complete: 0, mismatch: 0,
    });
  }

  for (const r of reports || []) {
    const created = new Date(r.created_at);
    const weekIndex = Math.min(
      weeks - 1,
      Math.max(0, Math.floor((created - since) / (7 * 24 * 60 * 60 * 1000)))
    );
    if (buckets[weekIndex] && VALID_CATEGORIES.includes(r.category)) {
      buckets[weekIndex][r.category]++;
    }
  }

  return buckets.map(({ weekStart, ...rest }) => rest);
}

// ---------------------------------------------------------------------------
// PROJECTS
// ---------------------------------------------------------------------------

async function getProjectsForArea({ county, constituency, ward }, limit = 20) {
  let query = supabase
    .from("projects")
    .select("id, code, title, budget, official_status, expected_completion, ward")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (county) query = query.eq("county", county);
  if (constituency) query = query.eq("constituency", constituency);
  if (ward) query = query.eq("ward", ward);

  const { data, error } = await query;
  if (error) {
    console.error("[DB] getProjectsForArea error:", error);
    return [];
  }
  return data || [];
}

async function getProjectByCode(code) {
  if (!code) return null;
  const { data, error } = await supabase
    .from("projects")
    .select("*, promises:promise_id (title, description, promised_by, sector, deadline, source_text)")
    .ilike("code", code.trim())
    .maybeSingle();
  if (error) {
    console.error("[DB] getProjectByCode error:", error);
    return null;
  }
  return data;
}

async function getProjectById(id) {
  if (!id || !isValidUUID(id)) return null;
  const { data, error } = await supabase
    .from("projects")
    .select("*, promises:promise_id (title, description, promised_by, sector, deadline, source_text)")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[DB] getProjectById error:", error);
    return null;
  }
  return data;
}

async function createPromiseAndProject(promiseFields, projectFields) {
  const { data: promise, error: promiseErr } = await supabase
    .from("promises")
    .insert(promiseFields)
    .select()
    .maybeSingle();
  if (promiseErr) {
    console.error("[DB] createPromiseAndProject (promise) error:", promiseErr);
    throw promiseErr;
  }

  const code = await generateNextProjectCode();
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .insert({ ...projectFields, promise_id: promise.id, code })
    .select()
    .maybeSingle();
  if (projectErr) {
    console.error("[DB] createPromiseAndProject (project) error:", projectErr);
    throw projectErr;
  }

  return { promise, project };
}

async function generateNextProjectCode() {
  const { count, error } = await supabase
    .from("projects")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("[DB] generateNextProjectCode error:", error);
    return `P${Date.now().toString().slice(-4)}`;
  }
  const next = (count || 0) + 1;
  return `P${String(next).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// PROJECT UPDATES — the official status history behind each case file.
// ---------------------------------------------------------------------------

const VALID_PROJECT_STATUSES = ["not_started", "ongoing", "delayed", "completed"];

async function getProjectUpdates(project_id) {
  if (!project_id || !isValidUUID(project_id)) return [];
  const { data, error } = await supabase
    .from("project_updates")
    .select("status, source, description, date")
    .eq("project_id", project_id)
    .order("date", { ascending: true });
  if (error) {
    console.error("[DB] getProjectUpdates error:", error);
    return [];
  }
  return data || [];
}

// Logs a new status-history entry AND keeps projects.official_status in sync,
// so the "Funded" clause and the timeline never disagree with each other.
async function createProjectUpdate({ project_id, status, source, description, date }) {
  if (!project_id || !isValidUUID(project_id)) throw new Error("Invalid project ID");
  if (!VALID_PROJECT_STATUSES.includes(status)) {
    throw new Error(`status must be one of: ${VALID_PROJECT_STATUSES.join(", ")}`);
  }

  const { data: update, error: updateErr } = await supabase
    .from("project_updates")
    .insert({ project_id, status, source: source || null, description: description || null, date: date || new Date().toISOString() })
    .select()
    .maybeSingle();
  if (updateErr) {
    console.error("[DB] createProjectUpdate (insert) error:", updateErr);
    throw updateErr;
  }

  const { error: syncErr } = await supabase
    .from("projects")
    .update({ official_status: status })
    .eq("id", project_id);
  if (syncErr) console.error("[DB] createProjectUpdate (sync status) error:", syncErr);

  return update;
}

// ---------------------------------------------------------------------------
// REPORTS — citizen evidence (spec sections 9-10)
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = ["not_started", "ongoing", "stalled", "complete", "mismatch"];

async function createReport({ project_id, phone, category, description, photo_url, latitude, longitude }) {
  if (!project_id || !isValidUUID(project_id)) throw new Error("Invalid project ID");
  if (!VALID_CATEGORIES.includes(category)) throw new Error("Invalid report category");

  let user_id = null;
  if (phone) {
    const user = await upsertCitizen({ phone });
    user_id = user?.id || null;
  }

  const { data, error } = await supabase
    .from("reports")
    .insert({ project_id, user_id, phone: phone || null, category, description: description || null, photo_url: photo_url || null, latitude, longitude })
    .select()
    .maybeSingle();

  if (error) {
    console.error("[DB] createReport error:", error);
    throw error;
  }
  return data;
}

async function getReportCountsForProject(project_id) {
  if (!project_id || !isValidUUID(project_id)) return {};
  const { data, error } = await supabase.from("reports").select("category").eq("project_id", project_id);
  if (error) {
    console.error("[DB] getReportCountsForProject error:", error);
    return {};
  }
  const counts = {};
  for (const row of data || []) {
    counts[row.category] = (counts[row.category] || 0) + 1;
  }
  return counts;
}

async function getRecentReports(project_id, limit = 10) {
  if (!project_id || !isValidUUID(project_id)) return [];
  const { data, error } = await supabase
    .from("reports")
    .select("category, description, photo_url, created_at")
    .eq("project_id", project_id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[DB] getRecentReports error:", error);
    return [];
  }
  return data || [];
}

// Uploads a citizen-submitted photo to the "report-photos" Supabase Storage
// bucket (created in schema.sql) and returns its public URL. Buffer comes
// straight from multer's memoryStorage — nothing is written to local disk.
async function uploadReportPhoto(file, project_id) {
  const ext = (file.originalname.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${project_id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from("report-photos")
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

  if (uploadErr) {
    console.error("[DB] uploadReportPhoto error:", uploadErr);
    throw uploadErr;
  }

  const { data } = supabase.storage.from("report-photos").getPublicUrl(path);
  return data.publicUrl;
}

// ---------------------------------------------------------------------------
// USERS / CITIZENS
// ---------------------------------------------------------------------------

async function upsertCitizen({ phone, name, location }) {
  const { data: existing, error: findErr } = await supabase
    .from("users")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();
  if (findErr) console.error("[DB] upsertCitizen lookup error:", findErr);

  if (existing) {
    const updates = {};
    if (name && name !== existing.name) updates.name = name;
    if (location && location !== existing.location) updates.location = location;
    if (Object.keys(updates).length === 0) return existing;

    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", existing.id)
      .select()
      .maybeSingle();
    if (error) {
      console.error("[DB] upsertCitizen update error:", error);
      return existing;
    }
    return data || existing;
  }

  const { data, error } = await supabase
    .from("users")
    .insert({ phone, name: name || null, location: location || null })
    .select()
    .maybeSingle();
  if (error) {
    console.error("[DB] upsertCitizen insert error:", error);
    throw error;
  }
  return data;
}

// ---------------------------------------------------------------------------
// FOLLOWS — SMS subscriptions (spec section 17)
// ---------------------------------------------------------------------------

async function followProject({ phone, project_id }) {
  if (!project_id || !isValidUUID(project_id)) throw new Error("Invalid project ID");
  const { data, error } = await supabase
    .from("follows")
    .upsert({ phone, project_id }, { onConflict: "project_id,phone" })
    .select()
    .maybeSingle();
  if (error) {
    console.error("[DB] followProject error:", error);
    throw error;
  }
  return data;
}

async function unfollowProject({ phone, project_id }) {
  if (!project_id || !isValidUUID(project_id)) throw new Error("Invalid project ID");
  const { error } = await supabase.from("follows").delete().eq("phone", phone).eq("project_id", project_id);
  if (error) {
    console.error("[DB] unfollowProject error:", error);
    throw error;
  }
  return true;
}

async function getFollowersForProject(project_id) {
  if (!project_id || !isValidUUID(project_id)) return [];
  const { data, error } = await supabase.from("follows").select("phone").eq("project_id", project_id);
  if (error) {
    console.error("[DB] getFollowersForProject error:", error);
    return [];
  }
  return (data || []).map((r) => r.phone);
}

module.exports = {
  isValidUUID,
  getCounties,
  getConstituencies,
  getWards,
  getDefaultArea,
  getAreaSummary,
  getWardLeaderboard,
  getMostFlaggedProjects,
  getBudgetBySector,
  getReportsTrend,
  getProjectsForArea,
  getProjectByCode,
  getProjectById,
  createPromiseAndProject,
  getProjectUpdates,
  createProjectUpdate,
  VALID_PROJECT_STATUSES,
  createReport,
  getReportCountsForProject,
  getRecentReports,
  uploadReportPhoto,
  upsertCitizen,
  followProject,
  unfollowProject,
  getFollowersForProject,
  VALID_CATEGORIES,
};