# Atlas Query Agent Demo

This website turns English program-analysis requests into copyable Atlas Query scripts. A language model chooses a recipe and extracts the function name; the server fills a local query template. The website does not run the resulting query in Atlas.

## Requirements

- Node.js 18 or newer
- Access to an OpenAI-compatible chat-completions model

## Configure

Copy the public sample to a local configuration file:

```bash
cp config/llm.config.sample.json config/llm.config.json
```

Edit `model` and `baseURL` in `config/llm.config.json`. Set the environment variable named by `apiKeyEnv`, or set `apiKey` in the local file. The local file is ignored by Git; do not commit real credentials.

The sample has placeholder values and cannot call a model until configured.

## Run

```bash
npm run serve
```

Open `http://localhost:5173/` or `http://localhost:5173/index.html`. To use another port, set `PORT` before starting the server.

## How it works

1. The user enters an English request or selects an example.
2. The server sends the request and a compact catalog of local recipes to the model.
3. The model returns JSON with an `intentId`, `slots`, and `confidence`.
4. The server selects a recipe from `data/atlas_recipes.json`, inserts the extracted function name, checks the generated text, and returns a copyable Atlas Query.

## Validate

```bash
npm run check
```

This local check verifies the bundled examples and the English-only source files. It does not call the language model or execute an Atlas Query.

## Files

- `index.html`: website entry page
- `src/app-v2.js`: browser interactions
- `src/atlasAgent.js`: template rendering and query checks
- `server.mjs`: static-file serving and language-model request handling
- `data/atlas_recipes.json`: local recipe catalog and query templates
- `config/llm.config.sample.json`: public configuration sample
- `DEPLOYMENT.md`: Linux deployment notes
