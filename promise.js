(async function () {
  const content = document.getElementById("content");
  const id = Ahadi.qs("id");

  const CATEGORY_OPTIONS = [
    { value: "not_started", label: "Work has not started" },
    { value: "ongoing", label: "Work is ongoing" },
    { value: "stalled", label: "Work has stalled" },
    { value: "complete", label: "Project appears complete" },
    { value: "mismatch", label: "Something doesn't match" },
  ];

  if (!id) {
    content.innerHTML = `<div class="status-msg status-msg--error">No case file specified. <a href="/index.html">Return to the register.</a></div>`;
    return;
  }

  let data;
  try {
    data = await Ahadi.api(`/promises/${id}`);
  } catch (err) {
    content.innerHTML = `<div class="status-msg status-msg--error">${Ahadi.escapeHtml(err.message)} <a href="/index.html">Return to the register.</a></div>`;
    return;
  }

  render(data);

  function render({ project, realityCheck, recentReports, statusHistory }) {
    const promise = project.promises || {};
    const stamp = Ahadi.stampHtml(project.official_status, project.expected_completion, "lg");

    const historyHtml = (statusHistory || []).length === 0
      ? ""
      : `
        <h4 style="font-size:0.9rem; margin-top:22px;">Status history</h4>
        <div class="timeline">
          ${statusHistory.map((h) => `
            <div class="timeline__entry">
              <div class="timeline__date">${new Date(h.date).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}</div>
              <div class="timeline__status">${Ahadi.escapeHtml(Ahadi.statusLabel(h.status))}</div>
              <div class="timeline__desc">${Ahadi.escapeHtml(h.description || "")}${h.source ? ` <span class="timeline__source">— ${Ahadi.escapeHtml(h.source)}</span>` : ""}</div>
            </div>
          `).join("")}
        </div>
      `;

    const flagsHtml = realityCheck.flags.map((f) => `
      <div class="flag-notice ${f.type === "community_pattern" ? "flag-notice--info" : ""}">
        <strong>⚠</strong>
        <span>${Ahadi.escapeHtml(f.message)}</span>
      </div>
    `).join("");

    const tallyHtml = CATEGORY_OPTIONS.map((c) => `
      <div class="tally">
        <span class="tally__num">${realityCheck.counts[c.value] || 0}</span>
        <span class="tally__label">${Ahadi.escapeHtml(c.label)}</span>
      </div>
    `).join("");

    const testimonyHtml = recentReports.length === 0
      ? `<p style="color:var(--ink-soft);">No community reports yet. Be the first to record what you're seeing.</p>`
      : recentReports.map((r) => `
        <div class="testimony">
          <div>${Ahadi.escapeHtml(Ahadi.statusLabel(r.category))}${r.description ? ` — ${Ahadi.escapeHtml(r.description)}` : ""}</div>
          ${r.photo_url ? `<a href="${Ahadi.escapeHtml(r.photo_url)}" target="_blank" rel="noopener"><img class="testimony__photo" src="${Ahadi.escapeHtml(r.photo_url)}" alt="Photo evidence submitted with this report" loading="lazy"></a>` : ""}
          <div class="testimony__meta">${new Date(r.created_at).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}</div>
        </div>
      `).join("");

    content.innerHTML = `
      <div class="eyebrow print-only" id="print-citation" style="margin-top:0;"></div>
      <div class="eyebrow no-print" style="margin-top:32px; display:flex; justify-content:space-between; align-items:baseline;">
        <span>Case File ${Ahadi.escapeHtml(project.code)}</span>
        <button type="button" class="btn btn--ghost" id="print-btn" style="padding:6px 12px; font-size:0.7rem;">Print / Export</button>
      </div>
      <div class="detail-head">
        <div>
          <h2>${Ahadi.escapeHtml(project.title)}</h2>
          <div class="detail-head__meta">${Ahadi.escapeHtml(project.ward || "")} · ${Ahadi.escapeHtml(promise.sector || "")}</div>
        </div>
        ${stamp}
      </div>

      <div class="clause">
        <div class="clause__label"><span class="clause__number">I.</span>Promised</div>
        <div class="clause__body">
          <p>${Ahadi.escapeHtml(promise.description || project.title)}</p>
          <dl>
            <dt>Promised by</dt><dd>${Ahadi.escapeHtml(promise.promised_by || "Unknown")}</dd>
            <dt>Deadline</dt><dd>${Ahadi.escapeHtml(promise.deadline || "Unspecified")}</dd>
            <dt>Sector</dt><dd>${Ahadi.escapeHtml(promise.sector || "Unspecified")}</dd>
          </dl>
        </div>
      </div>

      <div class="clause">
        <div class="clause__label"><span class="clause__number">II.</span>Funded</div>
        <div class="clause__body">
          <dl>
            <dt>Allocated</dt><dd>${Ahadi.money(project.budget)}</dd>
            <dt>Official status</dt><dd>${Ahadi.escapeHtml(Ahadi.statusLabel(project.official_status))}</dd>
            <dt>Expected completion</dt><dd>${project.expected_completion ? new Date(project.expected_completion).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" }) : "Unspecified"}</dd>
          </dl>
          ${historyHtml}
        </div>
      </div>

      <div class="clause">
        <div class="clause__label"><span class="clause__number">III.</span>Reality</div>
        <div class="clause__body">
          <p style="color:var(--ink-soft);">${realityCheck.total} community reports on file.</p>
          <div class="report-tally">${tallyHtml}</div>
          ${flagsHtml}
          <h4 style="font-size:0.95rem; margin-top:20px;">Recent testimony</h4>
          ${testimonyHtml}
        </div>
      </div>

      <hr class="rule rule--strong">

      <div class="panel">
        <div class="panel__title">File a Report</div>
        <form id="report-form" class="report-form">
          <p class="eyebrow" style="margin-bottom:10px;">What is happening?</p>
          <div class="options">
            ${CATEGORY_OPTIONS.map((c, i) => `
              <label><input type="radio" name="category" value="${c.value}" ${i === 0 ? "required" : ""}> ${Ahadi.escapeHtml(c.label)}</label>
            `).join("")}
          </div>
          <div class="field" style="margin-top:14px;">
            <label for="description">Tell us what you're seeing (optional)</label>
            <textarea id="description" name="description" placeholder="e.g. Construction stopped two months ago."></textarea>
          </div>
          <div class="field" style="margin-top:14px;">
            <label for="photo">Upload a photo (optional)</label>
            <input type="file" id="photo" name="photo" accept="image/*">
            <div id="photo-preview-wrap"></div>
          </div>
          <div class="field" style="margin-top:14px; max-width: 260px;">
            <label for="phone">Your phone number (optional)</label>
            <input type="tel" id="phone" name="phone" placeholder="+2547...">
          </div>
          <div class="actions-row">
            <button type="submit" class="btn">Submit Report</button>
            <button type="button" class="btn btn--ghost" id="follow-btn">Follow This Project</button>
          </div>
          <div id="form-status" class="status-msg"></div>
        </form>
        <div class="channel-note">
          No internet? Text <strong>REPORT ${Ahadi.escapeHtml(project.code)} &lt;1-5&gt;</strong> to our SMS
          shortcode, or dial the USSD code and choose "Report progress" — see
          <a href="/learn.html#feature-phone">how to use Ahadi without data</a>.
        </div>
      </div>
    `;

    document.getElementById("print-citation").textContent =
      `Ahadi case file ${project.code} — printed ${new Date().toLocaleDateString("en-KE", { year: "numeric", month: "long", day: "numeric" })} — ${window.location.href}`;

    document.getElementById("print-btn").addEventListener("click", () => window.print());

    document.getElementById("photo").addEventListener("change", (e) => {
      const wrap = document.getElementById("photo-preview-wrap");
      wrap.innerHTML = "";
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        wrap.innerHTML = `<p class="status-msg status-msg--error">That photo is over 5MB — please choose a smaller one.</p>`;
        e.target.value = "";
        return;
      }
      const img = document.createElement("img");
      img.className = "photo-preview";
      img.src = URL.createObjectURL(file);
      img.alt = "Selected photo preview";
      wrap.appendChild(img);
    });

    document.getElementById("report-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const form = e.target;
      const category = form.category.value;
      const description = form.description.value.trim();
      const phone = form.phone.value.trim();
      const photoFile = document.getElementById("photo").files[0];
      const statusEl = document.getElementById("form-status");
      statusEl.textContent = photoFile ? "Uploading photo and submitting…" : "Submitting…";
      statusEl.className = "status-msg";
      try {
        const formData = new FormData();
        formData.append("category", category);
        if (description) formData.append("description", description);
        if (phone) formData.append("phone", phone);
        if (photoFile) formData.append("photo", photoFile);

        await Ahadi.apiForm(`/promises/${project.id}/reports`, formData);
        statusEl.textContent = "Thank you — your report has been recorded and added to the tally above.";
        statusEl.className = "status-msg status-msg--ok";
        form.reset();
        document.getElementById("photo-preview-wrap").innerHTML = "";
      } catch (err) {
        statusEl.textContent = err.message;
        statusEl.className = "status-msg status-msg--error";
      }
    });

    document.getElementById("follow-btn").addEventListener("click", async () => {
      const phoneInput = document.getElementById("phone");
      const statusEl = document.getElementById("form-status");
      const phone = phoneInput.value.trim();
      if (!phone) {
        statusEl.textContent = "Add your phone number above first so we know where to send updates.";
        statusEl.className = "status-msg status-msg--error";
        phoneInput.focus();
        return;
      }
      try {
        await Ahadi.api(`/promises/${project.id}/follow`, {
          method: "POST",
          body: JSON.stringify({ phone }),
        });
        statusEl.textContent = `You're now following this project. We'll text ${phone} when there's an update.`;
        statusEl.className = "status-msg status-msg--ok";
      } catch (err) {
        statusEl.textContent = err.message;
        statusEl.className = "status-msg status-msg--error";
      }
    });
  }
})();