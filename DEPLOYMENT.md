# AtlasQ Demo Linux Deployment

This folder contains the complete runtime files for the Atlas Query Agent Demo website.

## 1. Copy to Server

Place this directory on the server:

```bash
/var/www/AtlasQ-demo
```

## 2. Create Local LLM Config

On the server:

```bash
cd /var/www/AtlasQ-demo
cp config/llm.config.sample.json config/llm.config.json
```

Edit `config/llm.config.json` and set the correct `model`, `baseURL`, and `apiKeyEnv`.

The public sample uses this shape:

```json
{
  "provider": "dashscope-compatible",
  "model": "YOUR_MODEL_NAME",
  "baseURL": "https://YOUR_ENDPOINT/compatible-mode/v1",
  "apiKeyEnv": "DASHSCOPE_API_KEY",
  "apiKey": "",
  "temperature": 0,
  "timeoutMs": 30000
}
```

Do not place the real API key in frontend files.

## 3. Set API Key as Environment Variable

```bash
export DASHSCOPE_API_KEY="your-real-key"
```

For production, set this through your process manager or systemd service instead of typing it manually.

## 4. Run the Server

```bash
PORT=8080 npm run serve
```

Open:

```text
http://YOUR_SERVER:8080/
```

## 5. Optional Nginx Reverse Proxy

Example:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /config/ {
        deny all;
    }
}
```

The Node server also blocks `/config/*` requests.

## 6. Validate

```bash
npm run check
```

This does not call the LLM. It validates the local recipe pipeline and English-only demo files.
