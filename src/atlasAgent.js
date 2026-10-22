const STOP_WORDS = new Set([
  "show",
  "find",
  "select",
  "display",
  "count",
  "how",
  "many",
  "number",
  "all",
  "that",
  "return",
  "generate",
  "list",
  "inside",
  "within",
  "function",
  "functions",
  "called",
  "caller",
  "callers",
  "callee",
  "callees",
  "graph",
  "cfg",
  "control",
  "flow",
  "branch",
  "branches",
  "condition",
  "conditions",
  "loop",
  "loops",
  "nested",
  "edge",
  "edges",
  "back",
  "for",
  "of",
  "in",
  "by",
  "the",
  "a",
  "an",
  "to",
  "from",
  "with",
  "and"
]);

const TAG_CORRECTIONS = new Map([
  ["XCSG.loop", "XCSG.Loop"],
  ["XCSG.Loopchild", "XCSG.LoopChild"],
  ["XCSG.loopChild", "XCSG.LoopChild"],
  ["XCSG.controlFlowCondition", "XCSG.ControlFlowCondition"],
  ["XCSG.Controlflowcondition", "XCSG.ControlFlowCondition"],
  ["XCSG.controlFlowBackEdge", "XCSG.ControlFlowBackEdge"],
  ["XCSG.Controlflowbackedge", "XCSG.ControlFlowBackEdge"],
  ["XCSG.call", "XCSG.Call"]
]);

export async function loadRecipes(url = "./data/atlas_recipes.json") {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to load recipe database: ${response.status}`);
  }

  const payload = await response.json();
  return payload.recipes;
}

export function analyzeInput(input, recipes, explicitRecipeId = "") {
  const normalizedInput = normalizeText(input);
  const recipe = explicitRecipeId
    ? recipes.find((candidate) => candidate.id === explicitRecipeId)
    : classifyIntent(normalizedInput, recipes).recipe;
  const rankedRecipes = rankRecipes(normalizedInput, recipes);
  const slots = extractSlots(input, recipe);
  const missingSlots = listMissingSlots(recipe, slots);
  const warnings = [];

  if (!recipe) {
    return {
      ok: false,
      recipe: null,
      rankedRecipes,
      slots: {},
      query: "",
      confidence: 0,
      warnings: ["No matching Atlas recipe found."]
    };
  }

  const confidence = rankedRecipes.find((candidate) => candidate.recipe.id === recipe.id)?.confidence ?? 0.5;

  if (missingSlots.length > 0) {
    warnings.push(`Missing required slot: ${missingSlots.join(", ")}`);
  }

  if (confidence < 0.45 && !explicitRecipeId) {
    warnings.push("Low confidence match. Consider choosing a recipe manually.");
  }

  const rendered = missingSlots.length === 0 ? renderQuery(recipe, slots) : "";
  const lintResult = lintAtlasQuery(rendered, recipe);

  return {
    ok: missingSlots.length === 0,
    recipe,
    rankedRecipes,
    slots,
    query: lintResult.query,
    confidence,
    warnings: [...warnings, ...lintResult.warnings]
  };
}

export function classifyIntent(normalizedInput, recipes) {
  const rankedRecipes = rankRecipes(normalizedInput, recipes);
  return rankedRecipes[0] ?? { recipe: null, confidence: 0 };
}

export function rankRecipes(normalizedInput, recipes) {
  const ranked = recipes.map((recipe) => {
    const score = scoreRecipe(normalizedInput, recipe);
    return {
      recipe,
      confidence: Math.min(score / 8, 0.99),
      score
    };
  });

  return ranked.sort((left, right) => right.score - left.score).slice(0, 5);
}

export function extractSlots(input, recipe) {
  if (!recipe) {
    return {};
  }

  const slots = {};

  if (recipe.slots?.functionName) {
    const functionName = extractFunctionName(input);

    if (functionName) {
      slots.functionName = functionName;
      slots.functionVar = toAtlasIdentifier(functionName);
    }
  }

  return slots;
}

export function renderQuery(recipe, slots) {
  return Object.entries(slots).reduce((query, [key, value]) => {
    return query.replaceAll(`\${${key}}`, value);
  }, recipe.template);
}

export function lintAtlasQuery(query, recipe) {
  const warnings = [];
  let cleaned = query.replace(/```(?:scala|java|text)?/gi, "").replace(/```/g, "").trim();

  for (const [incorrect, correct] of TAG_CORRECTIONS.entries()) {
    if (cleaned.includes(incorrect)) {
      cleaned = cleaned.replaceAll(incorrect, correct);
      warnings.push(`Corrected ${incorrect} to ${correct}.`);
    }
  }

  const unresolvedSlots = cleaned.match(/\$\{[A-Za-z0-9_]+\}/g) ?? [];

  if (unresolvedSlots.length > 0) {
    warnings.push(`Unresolved template slot(s): ${[...new Set(unresolvedSlots)].join(", ")}`);
  }

  const usedTags = [...cleaned.matchAll(/XCSG\.[A-Za-z0-9_]+/g)].map((match) => match[0]);
  const unsupportedTags = usedTags.filter((tag) => !recipe.allowed_tags.includes(tag));

  if (unsupportedTags.length > 0) {
    warnings.push(`Unsupported XCSG tag(s): ${[...new Set(unsupportedTags)].join(", ")}`);
  }

  const variableDefinitions = [...cleaned.matchAll(/^\s*var\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map((match) => match[1]);
  const duplicateDefinitions = variableDefinitions.filter((name, index) => variableDefinitions.indexOf(name) !== index);

  if (duplicateDefinitions.length > 0) {
    warnings.push(`Duplicate variable definition(s): ${[...new Set(duplicateDefinitions)].join(", ")}`);
  }

  return {
    query: cleaned,
    warnings
  };
}

function scoreRecipe(normalizedInput, recipe) {
  let score = 0;

  for (const keyword of recipe.confidence_keywords ?? []) {
    if (normalizedInput.includes(normalizeText(keyword))) {
      score += keyword.includes(" ") ? 3 : 2;
    }
  }

  for (const example of recipe.natural_language_examples ?? []) {
    const exampleTokens = tokenize(normalizeText(example));
    const overlap = exampleTokens.filter((token) => normalizedInput.includes(token)).length;
    score += overlap * 0.75;
  }

  if (normalizedInput.includes("count") || normalizedInput.includes("how many") || normalizedInput.includes("number")) {
    score += recipe.output_type === "count" ? 4 : -1;
  }

  if (normalizedInput.includes("show") || normalizedInput.includes("display") || normalizedInput.includes("list")) {
    score += recipe.output_type === "graph" ? 1 : 0;
  }

  if (normalizedInput.includes("functions called by") || normalizedInput.includes("called functions")) {
    score += recipe.id === "show_call_graph" ? 5 : 0;
  }

  if (
    normalizedInput.includes("caller") ||
    normalizedInput.includes("functions that call") ||
    (normalizedInput.includes("called by") && !normalizedInput.includes("functions called by"))
  ) {
    score += recipe.id === "show_callers" ? 4 : 0;
  }

  if (normalizedInput.includes("called by") && !normalizedInput.includes("functions called by")) {
    score += recipe.id === "show_call_graph" ? -3 : 0;
  }

  if (normalizedInput.includes("nested") || normalizedInput.includes("contained loop")) {
    score += recipe.id === "find_nested_loops" ? 5 : 0;
  }

  if (normalizedInput.includes("back edge") || normalizedInput.includes("back-edge") || normalizedInput.includes("backedge")) {
    score += recipe.id === "find_back_edges" ? 5 : 0;
  }

  return Math.max(score, 0);
}

function extractFunctionName(input) {
  const quoted = input.match(/["'“”‘’`]([A-Za-z_][A-Za-z0-9_*]*)["'“”‘’`]/);

  if (quoted) {
    return quoted[1];
  }

  const directPatterns = [
    /(?:function|func|fn)\s+([A-Za-z_][A-Za-z0-9_*]*)/i,
    /(?:functions that call|functions that invoke|called by)\s+([A-Za-z_][A-Za-z0-9_*]*)/i,
    /(?:of|for|in|inside|within|called by|callers of|callees of|from)\s+([A-Za-z_][A-Za-z0-9_*]*)/i,
    /([A-Za-z_][A-Za-z0-9_*]*)\s+(?:function)/i
  ];

  for (const pattern of directPatterns) {
    const match = input.match(pattern);

    if (match?.[1] && isLikelyFunctionName(match[1])) {
      return match[1];
    }
  }

  const candidates = input.match(/\b[A-Za-z_][A-Za-z0-9_*]*\b/g) ?? [];
  const candidate = candidates.find((word) => isLikelyFunctionName(word));
  return candidate ?? "";
}

function isLikelyFunctionName(word) {
  const normalizedWord = word.toLowerCase();

  if (STOP_WORDS.has(normalizedWord)) {
    return false;
  }

  return /[A-Za-z_]/.test(word);
}

function listMissingSlots(recipe, slots) {
  if (!recipe?.slots) {
    return [];
  }

  return Object.entries(recipe.slots)
    .filter(([, config]) => config.required)
    .map(([slotName]) => slotName)
    .filter((slotName) => !slots[slotName]);
}

function normalizeText(input) {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function tokenize(input) {
  return input
    .split(/[^a-z0-9_*]+/i)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function toAtlasIdentifier(value) {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_");
  const prefixed = /^[A-Za-z_]/.test(sanitized) ? sanitized : `fn_${sanitized}`;
  return prefixed || "target";
}
