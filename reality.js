// reality.js — The Reality Check Algorithm (spec section 13)
//
// Deliberately rule-based, not ML. Compares official status against
// citizen reports and surfaces neutral, evidence-based flags. It never
// concludes corruption or names a person responsible — see spec section 14.

const CATEGORY_LABELS = {
  not_started: "work has not started",
  ongoing: "work is ongoing",
  stalled: "work has stalled",
  complete: "project appears complete",
  mismatch: "something doesn't match",
};

// reportCounts looks like { not_started: 4, ongoing: 5, stalled: 9, complete: 0, mismatch: 2 }
function computeRealityCheck(project, reportCounts = {}) {
  const counts = {
    not_started: 0,
    ongoing: 0,
    stalled: 0,
    complete: 0,
    mismatch: 0,
    ...reportCounts,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const flags = [];

  const officialStatus = (project.official_status || "").toLowerCase();
  const deadlinePassed = project.expected_completion
    ? new Date(project.expected_completion) < new Date()
    : false;

  // Rule 1: official record says completed/ongoing-smoothly, but citizens
  // are reporting it hasn't started or has stalled.
  if (
    (officialStatus === "completed" || officialStatus === "ongoing") &&
    (counts.not_started > 0 || counts.stalled > 0) &&
    counts.stalled + counts.not_started >= counts.ongoing + counts.complete
  ) {
    flags.push({
      type: "discrepancy",
      severity: "warning",
      message:
        "Recent community reports indicate that project progress may not match the latest reported official status.",
    });
  }

  // Rule 2: deadline has passed and it isn't marked complete.
  if (deadlinePassed && officialStatus !== "completed") {
    flags.push({
      type: "delayed",
      severity: "warning",
      message:
        "This project's expected completion date has passed and it has not been marked complete.",
    });
  }

  // Rule 3: a strong, consistent community signal (10+ independent reports
  // pointing the same direction) is worth surfacing on its own.
  const [dominantCategory, dominantCount] = Object.entries(counts).sort(
    (a, b) => b[1] - a[1]
  )[0];
  if (dominantCount >= 10) {
    flags.push({
      type: "community_pattern",
      severity: "info",
      message: `Community pattern detected: ${dominantCount} independent reports indicate ${CATEGORY_LABELS[dominantCategory]}.`,
    });
  }

  return { total, counts, flags };
}

// Compact one-line summary for USSD/SMS where screen space is tight.
function summarizeForUssd(realityCheck) {
  if (realityCheck.total === 0) return "No citizen reports yet.";
  const parts = [
    `${realityCheck.counts.ongoing} ongoing`,
    `${realityCheck.counts.stalled} stalled`,
    `${realityCheck.counts.not_started} not started`,
  ];
  let line = `${realityCheck.total} reports: ${parts.join(", ")}.`;
  if (realityCheck.flags.length > 0) {
    line += ` FLAG: ${realityCheck.flags[0].message}`;
  }
  return line;
}

module.exports = { computeRealityCheck, summarizeForUssd, CATEGORY_LABELS };
