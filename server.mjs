import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lintAtlasQuery, renderQuery } from "./src/atlasAgent.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname);
const configPath = join(rootDir, "config", "llm.config.json");
const sampleConfigPath = join(rootDir, "config", "llm.config.sample.json");
const recipesPath = join(rootDir, "data", "atlas_recipes.json");
const port = Number(process.env.PORT ?? 5173);
const host = process.env.HOST ?? "127.0.0.1";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "POST" && url.pathname === "/api/v2/classify") {
      await handleClassify(request, response);
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}).listen(port, host, () => {
  console.log(`Atlas Query Agent demo running at http://${host}:${port}`);
  console.log("Home: /");
});

async function handleClassify(request, response) {
  const body = await readJsonBody(request);
  const input = String(body.input ?? "").trim();

  if (!input) {
    sendJson(response, 400, { error: "Input is required." });
    return;
  }

  const [config, recipes] = await Promise.all([loadConfig(), loadRecipes()]);
  const llmResult = await classifyWithLLM(input, recipes, config);
  const recipe = recipes.find((candidate) => candidate.id === llmResult.intentId);

  if (!recipe) {
    sendJson(response, 422, {
      error: "The model returned an unknown intentId.",
      llmResult
    });
    return;
  }

  const slots = normalizeSlots(llmResult.slots ?? {});
  const missingSlots = listMissingSlots(recipe, slots);

  if (missingSlots.length > 0) {
    sendJson(response, 200, {
      ok: false,
      recipe,
      slots,
      query: "",
      confidence: clampConfidence(llmResult.confidence),
      warnings: [`Missing required slot: ${missingSlots.join(", ")}`],
      llmResult
    });
    return;
  }

  const rendered = renderQuery(recipe, slots);
  const lintResult = lintAtlasQuery(rendered, recipe);

  sendJson(response, 200, {
    ok: true,
    recipe,
    slots,
    query: lintResult.query,
    confidence: clampConfidence(llmResult.confidence),
    warnings: lintResult.warnings,
    llmResult
  });
}

async function classifyWithLLM(input, recipes, config) {
  const apiKey = resolveApiKey(config);
  const baseURL = String(config.baseURL ?? "").replace(/\/+$/, "");
  const model = String(config.model ?? "").trim();

  if (!apiKey) {
    throw new Error("No API key configured. Set apiKey or apiKeyEnv in config/llm.config.json.");
  }

  if (!baseURL) {
    throw new Error("Missing baseURL in config/llm.config.json.");
  }

  if (!model) {
    throw new Error("Missing model in config/llm.config.json.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(config.timeoutMs ?? 30000));

  try {
    const completionResponse = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: Number(config.temperature ?? 0),
        messages: buildMessages(input, recipes)
      }),
      signal: controller.signal
    });

    const payload = await completionResponse.json().catch(() => ({}));

    if (!completionResponse.ok) {
      throw new Error(payload.error?.message ?? `LLM request failed with status ${completionResponse.status}.`);
    }

    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("LLM response did not include message content.");
    }

    return parseModelJson(content);
  } finally {
    clearTimeout(timeout);
  }
}

function buildMessages(input, recipes) {
  const recipeCatalog = recipes.map((recipe) => {
    return {
      id: recipe.id,
      title: recipe.title,
      domain: recipe.domain,
      description: recipe.description,
      requiredSlots: Object.keys(recipe.slots ?? {}),
      examples: recipe.natural_language_examples
    };
  });

  return [
    {
      role: "system",
      content: [
        "You classify English requests for an Atlas Query generator.",
        "Return JSON only. Do not wrap the JSON in markdown.",
        "Choose exactly one intentId from the provided recipes.",
        "Extract only slots that are explicitly present or strongly implied.",
        "Do not write Atlas Query code.",
        "Schema: {\"intentId\":\"string\",\"slots\":{\"functionName\":\"string\"},\"confidence\":0.0}"
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        recipes: recipeCatalog,
        request: input
      })
    }
  ];
}

function parseModelJson(content) {
  const trimmed = String(content).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(jsonText);

  return {
    intentId: String(parsed.intentId ?? ""),
    slots: parsed.slots && typeof parsed.slots === "object" ? parsed.slots : {},
    confidence: clampConfidence(parsed.confidence)
  };
}

function normalizeSlots(slots) {
  const normalized = {};

  if (slots.functionName) {
    normalized.functionName = String(slots.functionName).trim();
    normalized.functionVar = toAtlasIdentifier(normalized.functionName);
  }

  return normalized;
}

function listMissingSlots(recipe, slots) {
  return Object.entries(recipe.slots ?? {})
    .filter(([, slot]) => slot.required)
    .map(([slotName]) => slotName)
    .filter((slotName) => !slots[slotName]);
}

function clampConfidence(value) {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return 0;
  }

  return Math.max(0, Math.min(numberValue, 1));
}

function toAtlasIdentifier(value) {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `fn_${sanitized}`;
}

async function loadConfig() {
  const targetPath = existsSync(configPath) ? configPath : sampleConfigPath;
  const config = JSON.parse(await readFile(targetPath, "utf8"));

  if (targetPath === sampleConfigPath) {
    throw new Error("Create config/llm.config.json from config/llm.config.sample.json before using the LLM.");
  }

  return config;
}

async function loadRecipes() {
  const payload = JSON.parse(await readFile(recipesPath, "utf8"));
  return payload.recipes;
}

function resolveApiKey(config) {
  if (config.apiKey) {
    return String(config.apiKey);
  }

  if (config.apiKeyEnv) {
    return process.env[String(config.apiKeyEnv)] ?? "";
  }

  return "";
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const bodyText = Buffer.concat(chunks).toString("utf8");
  return bodyText ? JSON.parse(bodyText) : {};
}

async function serveStatic(pathname, response) {
  if (pathname === "/" || pathname === "/index.html") {
    const filePath = join(rootDir, "index.html");
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(content);
    return;
  }

  if (pathname.startsWith("/src/")) {
    if (pathname.includes("atlasAgent.js")) {
      sendJson(response, 403, { error: "Forbidden. This is a server-side file." });
      return;
    }

    const ext = extname(pathname).toLowerCase();
    if (ext === ".css" || ext === ".js") {
      const filePath = normalize(join(rootDir, pathname));

      if (!filePath.startsWith(rootDir)) {
        sendJson(response, 403, { error: "Forbidden." });
        return;
      }

      try {
        const content = await readFile(filePath);
        response.writeHead(200, {
          "Content-Type": mimeTypes[ext] ?? "application/octet-stream"
        });
        response.end(content);
        return;
      } catch (e) {
        sendJson(response, 404, { error: "Not Found." });
        return;
      }
    }
  }

  sendJson(response, 404, { error: "Not Found." });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}
