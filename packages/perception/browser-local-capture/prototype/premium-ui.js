const iconForAction = (label) => {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized.includes("thumb") || normalized === "t") return "thumbs-up";
  if (normalized.includes("point") || normalized === "p") return "scan-eye";
  if (normalized.includes("heart") || normalized === "h") return "heart";
  return normalized === "g" ? "hand" : "sparkles";
};

const iconForPrimaryAction = (label) => {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized.includes("starting") || normalized.includes("ending")) return "loader-circle";
  if (normalized.includes("try again")) return "refresh-cw";
  if (normalized.includes("observ")) return "eye";
  return "sparkles";
};

function decoratePrimaryAction() {
  const button = document.querySelector("#analyzeMovement");
  if (!button || button.querySelector("svg, [data-lucide]")) return;
  const label = button.textContent.trim();
  button.replaceChildren();
  const icon = document.createElement("i");
  icon.dataset.lucide = iconForPrimaryAction(label);
  icon.setAttribute("aria-hidden", "true");
  const copy = document.createElement("span");
  copy.textContent = label;
  button.append(icon, copy);
}

function decorateSavedActions() {
  for (const row of document.querySelectorAll("#savedActionsList .sf-action-row")) {
    const iconSlot = row.querySelector(".sf-action-icon");
    if (iconSlot && !iconSlot.querySelector("svg, [data-lucide]")) {
      const icon = document.createElement("i");
      icon.dataset.lucide = iconForAction(`${iconSlot.textContent} ${row.querySelector("strong")?.textContent || ""}`);
      icon.setAttribute("aria-hidden", "true");
      iconSlot.replaceChildren(icon);
    }
    const state = row.querySelector(".sf-action-state");
    if (state) {
      const enabled = state.firstChild?.textContent?.trim().toLowerCase() === "enabled";
      state.dataset.enabled = String(enabled);
      if (!state.querySelector(".sf-status-toggle")) {
        const toggle = document.createElement("span");
        toggle.className = "sf-status-toggle";
        toggle.setAttribute("aria-hidden", "true");
        state.append(toggle);
      }
    }
    const chevron = row.querySelector(".sf-action-chevron");
    if (chevron && !chevron.querySelector("svg, [data-lucide]")) {
      chevron.replaceChildren();
      const icon = document.createElement("i");
      icon.dataset.lucide = "chevron-right";
      icon.setAttribute("aria-hidden", "true");
      chevron.append(icon);
    }
  }
  const viewAll = document.querySelector("#savedActionsList .sf-action-view-all");
  if (viewAll && !viewAll.querySelector("svg, [data-lucide]")) {
    viewAll.textContent = "View all actions";
    const icon = document.createElement("i");
    icon.dataset.lucide = "chevron-right";
    icon.setAttribute("aria-hidden", "true");
    viewAll.append(icon);
  }
}

function decorateConfidence() {
  const meta = document.querySelector("#movementSummaryRow");
  if (!meta || meta.querySelector(".sf-confidence-label")) return;
  const text = meta.textContent.trim();
  if (!text.toLowerCase().startsWith("confidence")) return;
  const numeric = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
  const bounded = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : null;
  const activeDots = bounded == null ? 0 : Math.round(bounded * 8);
  meta.replaceChildren();
  const icon = document.createElement("i");
  icon.dataset.lucide = "shield-check";
  icon.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "sf-confidence-label";
  label.textContent = "Confidence";
  const value = document.createElement("span");
  value.className = "sf-confidence-value";
  value.textContent = bounded == null ? text.replace(/^confidence\s*/i, "") : `${bounded >= 0.8 ? "High" : bounded >= 0.55 ? "Medium" : "Low"} (${bounded.toFixed(2)})`;
  const dots = document.createElement("span");
  dots.className = "sf-confidence-dots";
  dots.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 8; index += 1) {
    const dot = document.createElement("i");
    if (index < activeDots) dot.className = "is-active";
    dots.append(dot);
  }
  meta.append(icon, label, value, dots);
}

let lastMomentSignature;

function decorateRecentMoments() {
  const rows = [...document.querySelectorAll("#recentMomentsList .sf-moment-row")];
  const signature = rows.map((row) => row.textContent.trim()).join("|");
  if (lastMomentSignature !== undefined && signature && signature !== lastMomentSignature) {
    rows[0]?.classList.add("is-new-memory");
  }
  lastMomentSignature = signature;
}

function updateModeShell() {
  const selected = document.querySelector('#interactionModeSelector [data-interaction-mode][aria-pressed="true"]');
  document.body.dataset.activePerceptionMode = selected?.dataset.interactionMode || "conversation";
}

function updateCameraTransition() {
  const state = document.querySelector("#primaryObservationState");
  if (!state) return;
  state.hidden = ["", "ready", "listening", "watching"].includes(state.textContent.trim().toLowerCase());
}

function enhancePremiumUi() {
  decoratePrimaryAction();
  decorateSavedActions();
  decorateRecentMoments();
  decorateConfidence();
  updateModeShell();
  updateCameraTransition();
  if (document.querySelector("i[data-lucide]")) {
    globalThis.lucide?.createIcons?.({ attrs: { "stroke-width": 1.8 } });
  }
}

let scheduled = false;
const scheduleEnhancement = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhancePremiumUi();
  });
};

const root = document.querySelector("[data-primary-view]");
if (root) {
  new MutationObserver(scheduleEnhancement).observe(root, { childList: true, subtree: true, characterData: true });
  scheduleEnhancement();
}
