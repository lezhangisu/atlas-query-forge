import { readFile } from "node:fs/promises";
import { analyzeInput } from "../src/atlasAgent.js";

const recipePayload = JSON.parse(await readFile(new URL("../data/atlas_recipes.json", import.meta.url), "utf8"));

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

const failures = [];

for (const example of examples) {
  const result = analyzeInput(example, recipePayload.recipes);

  if (!result.ok || !result.query) {
    failures.push(`${example}: expected a generated query`);
    continue;
  }

  if (!result.slots.functionName) {
    failures.push(`${example}: expected functionName slot`);
  }

  if (/[\u3400-\u9fff]/u.test(JSON.stringify(result))) {
    failures.push(`${example}: result contains non-English CJK characters`);
  }
}

const sourceFiles = [
  "../index.html",
  "../src/app-v2.js",
  "../src/atlasAgent.js",
  "../src/styles.css",
  "../data/atlas_recipes.json",
  "../config/llm.config.sample.json",
  "../server.mjs",
  "../package.json",
  "../README.md",
  "../DEPLOYMENT.md"
];

for (const sourceFile of sourceFiles) {
  try {
    const content = await readFile(new URL(sourceFile, import.meta.url), "utf8");

    if (/[\u3400-\u9fff]/u.test(content)) {
      failures.push(`${sourceFile}: contains CJK characters`);
    }
  } catch (error) {
    if (sourceFile !== "../README.md") {
      failures.push(`${sourceFile}: ${error.message}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Demo check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Demo check passed for ${examples.length} examples.`);
