(async function () {
  const countySelect = document.getElementById("county-select");
  const constituencySelect = document.getElementById("constituency-select");
  const wardSelect = document.getElementById("ward-select");
  const areaSection = document.getElementById("area-section");
  const areaEyebrow = document.getElementById("area-eyebrow");
  const statStrip = document.getElementById("stat-strip");
  const promisesSection = document.getElementById("promises-section");
  const promisesHeading = document.getElementById("promises-heading");
  const caseList = document.getElementById("case-list");
  const statusMsg = document.getElementById("status-msg");

  async function loadOverview() {
    try {
      const { totals, wardLeaderboard, mostFlagged } = await Ahadi.api("/overview");

      const overviewStrip = document.getElementById("overview-stat-strip");
      overviewStrip.innerHTML = `
        <div class="stat"><span class="stat__num">${totals.tracked}</span><span class="stat__label">Tracked Promises</span></div>
        <div class="stat"><span class="stat__num">${Ahadi.money(totals.totalAllocated)}</span><span class="stat__label">Total Allocated</span></div>
        <div class="stat stat--ontrack"><span class="stat__num">${totals.onTrack}</span><span class="stat__label">On Track</span></div>
        <div class="stat stat--delayed"><span class="stat__num">${totals.delayed}</span><span class="stat__label">Delayed</span></div>
        <div class="stat stat--attention"><span class="stat__num">${totals.needsAttention}</span><span class="stat__label">Needs Attention</span></div>
      `;

      if (totals.tracked === 0) return; // nothing seeded yet — leave the detail panels hidden

      const leaderboardTable = document.getElementById("leaderboard-table");
      const worst = wardLeaderboard.slice(0, 8);
      leaderboardTable.innerHTML = `
        <thead><tr><th>Ward</th><th>On Track</th><th>Delayed</th><th>Attn.</th></tr></thead>
        <tbody>
          ${worst.map((w) => `
            <tr>
              <td><a href="#" class="leaderboard__ward-link" data-county="${Ahadi.escapeHtml(w.county)}" data-constituency="${Ahadi.escapeHtml(w.constituency)}" data-ward="${Ahadi.escapeHtml(w.ward)}">${Ahadi.escapeHtml(w.ward)}</a></td>
              <td class="mono">${w.onTrack}</td>
              <td class="mono">${w.delayed}</td>
              <td class="mono">${w.needsAttention}</td>
            </tr>
          `).join("")}
        </tbody>
      `;
      leaderboardTable.querySelectorAll(".leaderboard__ward-link").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          const { county, constituency, ward } = link.dataset;
          selectArea(county, constituency, ward);
        });
      });

      const flaggedList = document.getElementById("flagged-list");
      flaggedList.innerHTML = mostFlagged.length === 0
        ? `<p style="color:var(--ink-soft);">No discrepancies flagged yet.</p>`
        : mostFlagged.map((p) => `
            <a class="case-card" href="/promise.html?id=${p.id}" style="grid-template-columns: 1fr; gap: 4px; padding: 14px 4px;">
              <div class="case-card__code">${Ahadi.escapeHtml(p.code)} · ${Ahadi.escapeHtml(p.ward || "")}</div>
              <div class="case-card__title" style="font-size:1rem;">${Ahadi.escapeHtml(p.title)}</div>
              <div class="case-card__meta">${Ahadi.escapeHtml(p.topFlag)}</div>
            </a>
          `).join("");

      document.getElementById("overview-detail").hidden = false;
    } catch (err) {
      console.error("[dashboard] overview failed:", err);
    }
  }

  // Lets the leaderboard jump straight to a ward without the user re-picking
  // through the three dropdowns manually.
  async function selectArea(county, constituency, ward) {
    if (countySelect.options.length <= 1) await loadCounties(); // populate once, only if not already loaded
    countySelect.value = county;
    await onCountyChange();
    constituencySelect.value = constituency;
    await onConstituencyChange();
    wardSelect.value = ward;
    await onWardChange();
    document.getElementById("area-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function fillSelect(select, items, placeholder) {
    select.innerHTML = `<option value="">${placeholder}</option>` +
      items.map((i) => `<option value="${Ahadi.escapeHtml(i)}">${Ahadi.escapeHtml(i)}</option>`).join("");
    select.disabled = items.length === 0;
  }

  async function loadCounties() {
    try {
      const { counties } = await Ahadi.api("/locations/counties");
      if (counties.length === 0) {
        statusMsg.textContent = "No areas are being tracked yet. Seed the demo data to get started.";
        statusMsg.className = "status-msg status-msg--error";
        return;
      }
      fillSelect(countySelect, counties, "Select county");
      if (counties.length === 1) {
        countySelect.value = counties[0];
        await onCountyChange();
      }
    } catch (err) {
      statusMsg.textContent = err.message;
      statusMsg.className = "status-msg status-msg--error";
    }
  }

  async function onCountyChange() {
    const county = countySelect.value;
    fillSelect(wardSelect, [], "Select constituency first");
    if (!county) return fillSelect(constituencySelect, [], "Select county first");
    const { constituencies } = await Ahadi.api(`/locations/constituencies?county=${encodeURIComponent(county)}`);
    fillSelect(constituencySelect, constituencies, "Select constituency");
    if (constituencies.length === 1) {
      constituencySelect.value = constituencies[0];
      await onConstituencyChange();
    }
  }

  async function onConstituencyChange() {
    const county = countySelect.value;
    const constituency = constituencySelect.value;
    if (!constituency) return fillSelect(wardSelect, [], "Select constituency first");
    const { wards } = await Ahadi.api(
      `/locations/wards?county=${encodeURIComponent(county)}&constituency=${encodeURIComponent(constituency)}`
    );
    fillSelect(wardSelect, wards, "Select ward");
  }

  const charts = { sector: null, trend: null };
  const CHART_COLORS = {
    forest: "#1F3D2B", green: "#2F6B4A", gold: "#A9812F", red: "#9C3B2E", faint: "#7B8478", ink: "#1C2620",
  };
  const chartsAvailable = typeof Chart !== "undefined";
  if (chartsAvailable) {
    Chart.defaults.font.family = "'IBM Plex Mono', monospace";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = CHART_COLORS.ink;
  } else {
    console.warn("[dashboard] Chart.js failed to load — charts panel will stay hidden.");
  }

  function renderCharts({ budgetBySector, reportsTrend }) {
    if (!chartsAvailable) return;
    const sectorCanvas = document.getElementById("sector-chart");
    const trendCanvas = document.getElementById("trend-chart");

    if (charts.sector) charts.sector.destroy();
    if (charts.trend) charts.trend.destroy();

    if (budgetBySector.length === 0) {
      sectorCanvas.getContext("2d").clearRect(0, 0, sectorCanvas.width, sectorCanvas.height);
    } else {
      charts.sector = new Chart(sectorCanvas, {
        type: "bar",
        data: {
          labels: budgetBySector.map((s) => s.sector),
          datasets: [{ data: budgetBySector.map((s) => s.total), backgroundColor: CHART_COLORS.forest, borderRadius: 0 }],
        },
        options: {
          indexAxis: "y",
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: "#C7C9B8" }, ticks: { callback: (v) => Ahadi.money(v) } },
            y: { grid: { display: false } },
          },
        },
      });
    }

    const catMeta = [
      { key: "not_started", label: "Not started", color: CHART_COLORS.faint },
      { key: "ongoing", label: "Ongoing", color: CHART_COLORS.green },
      { key: "stalled", label: "Stalled", color: CHART_COLORS.gold },
      { key: "complete", label: "Complete", color: CHART_COLORS.forest },
      { key: "mismatch", label: "Doesn't match", color: CHART_COLORS.red },
    ];
    charts.trend = new Chart(trendCanvas, {
      type: "bar",
      data: {
        labels: reportsTrend.map((w) => w.label),
        datasets: catMeta.map((c) => ({
          label: c.label,
          data: reportsTrend.map((w) => w[c.key] || 0),
          backgroundColor: c.color,
        })),
      },
      options: {
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 12 } } },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: "#C7C9B8" }, ticks: { precision: 0 } },
        },
      },
    });
  }

  async function onWardChange() {
    const county = countySelect.value;
    const constituency = constituencySelect.value;
    const ward = wardSelect.value;
    const chartsSection = document.getElementById("charts-section");
    if (!ward) { areaSection.hidden = true; promisesSection.hidden = true; chartsSection.hidden = true; return; }

    areaEyebrow.textContent = `${ward} — ${constituency}, ${county}`;
    statusMsg.textContent = "";

    const [{ summary }, { projects }, chartsData] = await Promise.all([
      Ahadi.api(`/area-summary?county=${encodeURIComponent(county)}&constituency=${encodeURIComponent(constituency)}&ward=${encodeURIComponent(ward)}`),
      Ahadi.api(`/promises?county=${encodeURIComponent(county)}&constituency=${encodeURIComponent(constituency)}&ward=${encodeURIComponent(ward)}`),
      Ahadi.api(`/area-summary/charts?county=${encodeURIComponent(county)}&constituency=${encodeURIComponent(constituency)}&ward=${encodeURIComponent(ward)}`),
    ]);

    statStrip.innerHTML = `
      <div class="stat"><span class="stat__num">${summary.tracked}</span><span class="stat__label">Tracked Promises</span></div>
      <div class="stat"><span class="stat__num">${Ahadi.money(summary.totalAllocated)}</span><span class="stat__label">Total Allocated</span></div>
      <div class="stat stat--ontrack"><span class="stat__num">${summary.onTrack}</span><span class="stat__label">On Track</span></div>
      <div class="stat stat--delayed"><span class="stat__num">${summary.delayed}</span><span class="stat__label">Delayed</span></div>
      <div class="stat stat--attention"><span class="stat__num">${summary.needsAttention}</span><span class="stat__label">Needs Attention</span></div>
    `;
    areaSection.hidden = false;

    if (chartsAvailable) {
      renderCharts(chartsData);
      chartsSection.hidden = false;
    } else {
      chartsSection.hidden = true;
    }

    promisesHeading.textContent = `Tracked Promises — ${ward}`;
    if (projects.length === 0) {
      caseList.innerHTML = `<div class="empty-state">No promises recorded for ${Ahadi.escapeHtml(ward)} yet.</div>`;
    } else {
      caseList.innerHTML = projects.map((p) => `
        <a class="case-card" href="/promise.html?id=${p.id}">
          <div>
            <div class="case-card__code">${Ahadi.escapeHtml(p.code)}</div>
            <div class="case-card__title">${Ahadi.escapeHtml(p.title)}</div>
            <div class="case-card__meta">${Ahadi.money(p.budget)} allocated · ${Ahadi.escapeHtml(p.ward || "")}</div>
          </div>
          ${Ahadi.stampHtml(p.official_status, p.expected_completion, "sm")}
        </a>
      `).join("");
    }
    promisesSection.hidden = false;
  }

  countySelect.addEventListener("change", onCountyChange);
  constituencySelect.addEventListener("change", onConstituencyChange);
  wardSelect.addEventListener("change", onWardChange);

  loadOverview();
  loadCounties();
})();