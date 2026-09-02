// seed.js — loads demonstration data (spec section 20).
// Scope: Nairobi County -> Kasarani constituency -> 4 wards, ~20 projects,
// each with a handful of simulated citizen reports. Clearly demo data —
// do not present this as live government data.
//
// Run with: npm run seed  (after schema.sql has been applied in Supabase)
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const COUNTY = "Nairobi";
const CONSTITUENCY = "Kasarani";
const WARDS = ["Clay City", "Mwiki", "Kasarani", "Njiru"];
const SECTORS = ["healthcare", "education", "water", "roads", "energy"];
const SOURCES = ["County development budget", "National government transfer", "Constituency Development Fund"];

const PROJECT_TITLES = [
  "Health Centre Construction",
  "Primary School Classrooms",
  "Borehole Drilling & Water Point",
  "Road Upgrade — Murram to Bitumen",
  "Street Lighting Installation",
  "Market Shed Construction",
  "Sewer Line Extension",
  "Youth Empowerment Centre",
  "Footbridge Construction",
  "Dispensary Renovation",
];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomStatus() {
  return randomChoice(["not_started", "ongoing", "delayed", "completed"]);
}

async function seed() {
  console.log("Seeding Ahadi demo data...");

  let projectCount = 0;
  const totalProjects = 20;

  for (let i = 0; i < totalProjects; i++) {
    const ward = randomChoice(WARDS);
    const titleBase = randomChoice(PROJECT_TITLES);
    const title = `${titleBase} — ${ward}`;
    const sector = randomChoice(SECTORS);
    const budget = randomBetween(5, 60) * 1000000;
    const deadlineYear = randomBetween(2025, 2027);
    const officialStatus = randomStatus();

    const { data: promise, error: promiseErr } = await supabase
      .from("promises")
      .insert({
        title,
        description: `${titleBase} in ${ward} ward, as committed in the ${CONSTITUENCY} development plan.`,
        promised_by: "County Government",
        sector,
        county: COUNTY,
        constituency: CONSTITUENCY,
        ward,
        deadline: String(deadlineYear),
        source_text: `Our administration will deliver "${titleBase}" in ${ward} before the end of ${deadlineYear}.`,
      })
      .select()
      .maybeSingle();

    if (promiseErr) {
      console.error("Failed to insert promise:", promiseErr);
      continue;
    }

    const code = `P${String(i + 30).padStart(3, "0")}`;
    const expectedCompletion = `${deadlineYear}-06-30`;

    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .insert({
        code,
        promise_id: promise.id,
        title,
        budget,
        official_status: officialStatus,
        start_date: `${deadlineYear - 1}-01-15`,
        expected_completion: expectedCompletion,
        county: COUNTY,
        constituency: CONSTITUENCY,
        ward,
      })
      .select()
      .maybeSingle();

    if (projectErr) {
      console.error("Failed to insert project:", projectErr);
      continue;
    }

    // Simulated citizen reports — skew the categories so some projects show
    // a clear discrepancy against their official_status (the "wow moment").
    const reportTotal = randomBetween(5, 20);
    const skewStalled = officialStatus === "completed" || officialStatus === "ongoing";
    const reports = [];
    for (let r = 0; r < reportTotal; r++) {
      const category = skewStalled && Math.random() < 0.5
        ? randomChoice(["stalled", "not_started"])
        : randomChoice(["ongoing", "stalled", "not_started", "complete", "mismatch"]);
      reports.push({
        project_id: project.id,
        category,
        description: randomChoice([
          "Construction has stopped for weeks.",
          "Workers are on site today.",
          "No equipment has arrived yet.",
          "Looks complete but not yet in use.",
          "Nothing has happened here since it was announced.",
          null,
        ]),
        phone: `+2547${randomBetween(10000000, 99999999)}`,
      });
    }

    const { error: reportsErr } = await supabase.from("reports").insert(reports);
    if (reportsErr) console.error("Failed to insert reports:", reportsErr);

    projectCount++;
    console.log(`  ✓ ${code} — ${title} (${reportTotal} reports)`);
  }

  console.log(`\nDone. Seeded ${projectCount} projects across ${WARDS.length} wards in ${CONSTITUENCY}, ${COUNTY}.`);
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { seed };