const examples = [
  "Show CFG for dskenq",
  "Find all loops in dskqopt",
  "Count loops in dskenq",
  "Count branches in dskqopt",
  "Find back edges in dskenq",
  "Show functions called by dskenq",
  "Show callers of freebuf",
  "Find nested loops in dskqopt"
];

const state = {
  lastResult: null
};

const elements = {
  requestInput: document.querySelector("#request-input"),
  generateButton: document.querySelector("#generate-button"),
  clearButton: document.querySelector("#clear-button"),
  exampleButtons: document.querySelector("#example-buttons"),
  status: document.querySelector("#v2-status"),
  confidenceBadge: document.querySelector("#confidence-badge"),
  activeRecipe: document.querySelector("#active-recipe"),
  llmJson: document.querySelector("#llm-json"),
  slotDisplay: document.querySelector("#slot-display"),
  queryOutput: document.querySelector("#query-output"),
  warningList: document.querySelector("#warning-list"),
  copyButton: document.querySelector("#copy-button")
};

init();

function init() {
  renderExamples();
  bindEvents();
  renderEmptyState();
}

function bindEvents() {
  elements.generateButton.addEventListener("click", generateWithLLM);

  elements.clearButton.addEventListener("click", () => {
    elements.requestInput.value = "";
    state.lastResult = null;
    renderEmptyState();
  });

  elements.copyButton.addEventListener("click", async () => {
    if (!state.lastResult?.query) {
      return;
    }

    await navigator.clipboard.writeText(state.lastResult.query);
    elements.copyButton.textContent = "Copied";
    window.setTimeout(() => {
      elements.copyButton.textContent = "Copy";
    }, 1200);
  });
}

function renderExamples() {
  elements.exampleButtons.innerHTML = examples
    .map((example) => `<button class="example-button" type="button" data-example="${escapeHtml(example)}">${escapeHtml(example)}</button>`)
    .join("");

  elements.exampleButtons.querySelectorAll("[data-example]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.requestInput.value = button.dataset.example;
      generateWithLLM();
    });
  });
}

async function generateWithLLM() {
  const input = elements.requestInput.value.trim();

  if (!input) {
    renderEmptyState();
    renderWarnings(["Enter an English request before generating."]);
    return;
  }

  setLoading(true);

  try {
    const response = await fetch("/api/v2/classify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error ?? `Request failed with status ${response.status}.`);
    }

    state.lastResult = result;
    renderResult(result);
  } catch (error) {
    state.lastResult = null;
    renderEmptyState();
    renderWarnings([error.message]);
  } finally {
    setLoading(false);
  }
}

function renderResult(result) {
  renderActiveRecipe(result);
  renderSlots(result);
  renderQuery(result);
  renderWarnings(result.warnings ?? []);
  elements.llmJson.textContent = JSON.stringify(result.llmResult ?? {}, null, 2);
}

function renderActiveRecipe(result) {
  if (!result.recipe) {
    elements.activeRecipe.className = "active-card empty-state";
    elements.activeRecipe.textContent = "No recipe matched this request.";
    elements.confidenceBadge.textContent = "No match";
    elements.confidenceBadge.className = "pill muted";
    return;
  }

  elements.activeRecipe.className = "active-card";
  elements.activeRecipe.innerHTML = `
    <div class="active-title">${escapeHtml(result.recipe.title)}</div>
    <div class="active-meta">${escapeHtml(result.recipe.domain)} · ${escapeHtml(result.recipe.output_type)}</div>
    <p class="active-meta">${escapeHtml(result.recipe.description)}</p>
  `;
  elements.confidenceBadge.textContent = `${Math.round((result.confidence ?? 0) * 100)}% confidence`;
  elements.confidenceBadge.className = (result.confidence ?? 0) >= 0.55 ? "pill" : "pill muted";
}

function renderSlots(result) {
  const slotEntries = Object.entries(result.slots ?? {}).filter(([key]) => key !== "functionVar");

  if (slotEntries.length === 0) {
    elements.slotDisplay.className = "slot-display empty-state";
    elements.slotDisplay.textContent = "No slots extracted yet.";
    return;
  }

  elements.slotDisplay.className = "slot-display";
  elements.slotDisplay.innerHTML = `
    <div class="slot-grid">
      ${slotEntries
        .map(([key, value]) => {
          return `
            <div class="slot-row">
              <span>${escapeHtml(key)}</span>
              <span class="slot-value">${escapeHtml(value)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderQuery(result) {
  if (!result.query) {
    elements.queryOutput.textContent = "Add the missing details to generate an Atlas Query.";
    elements.copyButton.disabled = true;
    return;
  }

  elements.queryOutput.textContent = result.query;
  elements.copyButton.disabled = false;
}

function renderWarnings(warnings) {
  if (!warnings.length && state.lastResult?.ok) {
    elements.warningList.innerHTML = `<div class="warning success">Query generated from a constrained recipe. Review it before running in Atlas.</div>`;
    return;
  }

  elements.warningList.innerHTML = warnings.map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("");
}

function renderEmptyState() {
  elements.status.textContent = "LLM mode";
  elements.confidenceBadge.textContent = "No result";
  elements.confidenceBadge.className = "pill muted";
  elements.activeRecipe.className = "active-card empty-state";
  elements.activeRecipe.textContent = "Enter a request to see the model-selected recipe.";
  elements.llmJson.textContent = "Model output will appear here.";
  elements.slotDisplay.className = "slot-display empty-state";
  elements.slotDisplay.textContent = "No slots extracted yet.";
  elements.queryOutput.textContent = "Generated Atlas Query will appear here.";
  elements.warningList.innerHTML = "";
  elements.copyButton.disabled = true;
}

function setLoading(isLoading) {
  elements.generateButton.disabled = isLoading;
  elements.generateButton.textContent = isLoading ? "Calling LLM..." : "Generate with LLM";
  elements.status.textContent = isLoading ? "Calling LLM" : "LLM mode";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
