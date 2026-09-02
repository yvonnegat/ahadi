(function () {
  const extractBtn = document.getElementById("extract-btn");
  const sourceText = document.getElementById("source-text");
  const extractStatus = document.getElementById("extract-status");
  const reviewPanel = document.getElementById("review-panel");
  const reviewForm = document.getElementById("review-form");
  const addStatus = document.getElementById("add-status");

  extractBtn.addEventListener("click", async () => {
    const text = sourceText.value.trim();
    if (!text) {
      extractStatus.textContent = "Paste some source text first.";
      extractStatus.className = "status-msg status-msg--error";
      return;
    }
    extractBtn.disabled = true;
    extractStatus.textContent = "Extracting…";
    extractStatus.className = "status-msg";
    try {
      const { extracted } = await Ahadi.api("/promises/extract", {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (extracted.action === "none") {
        extractStatus.textContent = "No clear public promise was found in that text. Try a more specific excerpt.";
        extractStatus.className = "status-msg status-msg--error";
        reviewPanel.hidden = true;
        return;
      }
      document.getElementById("title").value = extracted.project ? `${cap(extracted.action)} ${extracted.project}` : "";
      document.getElementById("promised_by").value = extracted.who !== "Unknown" ? extracted.who : "";
      document.getElementById("sector").value = extracted.sector !== "Unknown" ? extracted.sector : "";
      document.getElementById("deadline").value = extracted.deadline !== "Unknown" ? extracted.deadline : "";
      document.getElementById("ward").value = extracted.location !== "Unknown" ? extracted.location : "";
      document.getElementById("budget").value = extracted.budget ? extracted.budget : "";
      document.getElementById("description").value = text;
      extractStatus.textContent = "Promise detected. Review and complete the location and budget fields below.";
      extractStatus.className = "status-msg status-msg--ok";
      reviewPanel.hidden = false;
      reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      extractStatus.textContent = err.message;
      extractStatus.className = "status-msg status-msg--error";
    } finally {
      extractBtn.disabled = false;
    }
  });

  reviewForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    addStatus.textContent = "Saving…";
    addStatus.className = "status-msg";
    try {
      const { project } = await Ahadi.api("/promises", {
        method: "POST",
        body: JSON.stringify({
          title: document.getElementById("title").value.trim(),
          promised_by: document.getElementById("promised_by").value.trim(),
          sector: document.getElementById("sector").value.trim(),
          deadline: document.getElementById("deadline").value.trim(),
          county: document.getElementById("county").value.trim(),
          constituency: document.getElementById("constituency").value.trim(),
          ward: document.getElementById("ward").value.trim(),
          budget: Number(document.getElementById("budget").value) || 0,
          description: document.getElementById("description").value.trim(),
          source_text: sourceText.value.trim(),
        }),
      });
      addStatus.innerHTML = `Added to the register as <strong>${Ahadi.escapeHtml(project.code)}</strong>. <a href="/promise.html?id=${project.id}">View the case file →</a>`;
      addStatus.className = "status-msg status-msg--ok";
      reviewForm.reset();
    } catch (err) {
      addStatus.textContent = err.message;
      addStatus.className = "status-msg status-msg--error";
    }
  });

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
})();