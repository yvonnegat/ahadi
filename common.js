// common.js — shared helpers for every Ahadi page (no build step, no framework;
// plain fetch calls against the /api routes already defined on this same server).

const Ahadi = (() => {
  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  // Variant for multipart/form-data submissions (photo uploads) — no
  // Content-Type header here, the browser sets the multipart boundary itself.
  async function apiForm(path, formData, method = "POST") {
    const res = await fetch(`/api${path}`, { method, body: formData });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  }

  function money(n) {
    const v = Number(n) || 0;
    if (v >= 1_000_000) return `KSh ${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
    if (v >= 1_000) return `KSh ${(v / 1_000).toFixed(0)}K`;
    return `KSh ${v}`;
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  const STATUS_LABELS = {
    not_started: "Not started",
    ongoing: "Ongoing",
    stalled: "Stalled",
    delayed: "Delayed",
    completed: "Completed",
    mismatch: "Doesn't match",
    complete: "Appears complete",
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  // Maps an official_status + deadline to the stamp verdict shown as the
  // signature "seal" component across the site.
  function stampFor(officialStatus, expectedCompletion) {
    const s = (officialStatus || "").toLowerCase();
    const deadlinePassed = expectedCompletion ? new Date(expectedCompletion) < new Date() : false;
    if (s === "completed") return { cls: "", text: "Verified\nComplete" };
    if (s === "delayed" || (deadlinePassed && s !== "completed")) return { cls: "stamp--delayed", text: "Delayed" };
    if (s === "not_started") return { cls: "stamp--flagged", text: "Not\nStarted" };
    return { cls: "stamp--attention", text: "On\nRecord" };
  }

  function stampHtml(officialStatus, expectedCompletion, size = "") {
    const { cls, text } = stampFor(officialStatus, expectedCompletion);
    const sizeCls = size ? `stamp--${size}` : "";
    return `<div class="stamp ${cls} ${sizeCls}"><div class="stamp__text">${escapeHtml(text).replace("\n", "<br>")}</div></div>`;
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function setActiveNav() {
    const path = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".site-nav a").forEach((a) => {
      if (a.getAttribute("href") === path) a.setAttribute("aria-current", "page");
    });
  }

  document.addEventListener("DOMContentLoaded", setActiveNav);

  return { api, apiForm, money, escapeHtml, statusLabel, stampFor, stampHtml, qs };
})();