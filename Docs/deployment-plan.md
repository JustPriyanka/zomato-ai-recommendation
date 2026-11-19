# Deployment Plan

Backend → Railway · Frontend → Vercel

---

## Architecture

```
Browser → Vercel (React)  ──POST /api/recommend──▶  Railway (FastAPI)  ──▶  Groq LLM
                          ◀── JSON response ─────────────────────────────────────────
```

---

## Part 1 — Backend on Railway

### Prerequisites
- Railway account: [railway.app](https://railway.app)
- Project pushed to GitHub

### Steps

**1. Create a new Railway project**
- Go to [railway.app/new](https://railway.app/new) → "Deploy from GitHub repo"
- Select this repository
- Railway's Nixpacks auto-detects Python and installs from `requirements.txt`

**2. Set the start command**
Railway reads `Procfile` from the repo root — it's already set up:
```
web: uvicorn api:app --host 0.0.0.0 --port $PORT
```
No additional config needed.

**3. Set environment variables**
In Railway → your service → Variables tab, add:

| Variable | Value | Notes |
|---|---|---|
| `GROQ_API_KEY` | `gsk_...` | From [console.groq.com/keys](https://console.groq.com/keys) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Or any Groq model you prefer |
| `MAX_CANDIDATES` | `20` | Max restaurants passed to LLM |
| `TOP_K` | `5` | Recommendations returned |
| `ALLOWED_ORIGINS` | *(leave blank for now — add Vercel URL after Step 2)* | Comma-separated frontend URLs |
| `LOG_LEVEL` | `INFO` | Optional |

**4. Deploy**
- Railway auto-deploys on push to `main`
- First deploy takes 3–5 min (downloads ~600MB dataset from HuggingFace on startup)
- Subsequent deploys are fast (dataset not re-downloaded unless `--refresh` is passed)

**5. Note your Railway URL**
After deploy: Settings → Networking → Public Domain
Example: `https://zomato-ai.up.railway.app`

> ⚠️ **Cold starts:** Railway free tier spins down after inactivity. First request after sleep takes ~30s (dataset reload). Upgrade to Hobby tier ($5/mo) to keep it always-on.

---

## Part 2 — Frontend on Vercel

### Prerequisites
- Vercel account: [vercel.com](https://vercel.com)
- Same GitHub repo connected

### Steps

**1. Create a new Vercel project**
- Go to [vercel.com/new](https://vercel.com/new) → Import from GitHub
- Select this repository

**2. Configure the project**
In the import settings:

| Setting | Value |
|---|---|
| **Framework Preset** | Vite |
| **Root Directory** | `frontend` |
| **Build Command** | `npm run build` *(auto-detected)* |
| **Output Directory** | `dist` *(auto-detected)* |
| **Install Command** | `npm install` *(auto-detected)* |

**3. Set environment variables**
In Vercel → Project Settings → Environment Variables:

| Variable | Value | Environment |
|---|---|---|
| `VITE_API_URL` | `https://zomato-ai.up.railway.app` | Production |

> Leave `VITE_API_URL` empty for Preview/Development — the Vite proxy handles local dev traffic automatically.

**4. Deploy**
- Vercel auto-deploys on every push to `main`
- Build takes ~30s
- Note your Vercel URL: `https://your-app.vercel.app`

---

## Part 3 — Wire Up CORS

After both are deployed, go back to Railway and update `ALLOWED_ORIGINS`:

```
ALLOWED_ORIGINS=https://your-app.vercel.app
```

If you have multiple Vercel preview URLs or a custom domain, comma-separate them:
```
ALLOWED_ORIGINS=https://your-app.vercel.app,https://your-custom-domain.com
```

Railway redeploys automatically when env vars change.

---

## Part 4 — Smoke Test

Once both are live, test the full pipeline:

```bash
# 1. Health check
curl https://zomato-ai.up.railway.app/api/health
# Expected: {"status":"ok","restaurants":12499}

# 2. Locations endpoint
curl https://zomato-ai.up.railway.app/api/locations | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['locations']), 'locations')"
# Expected: 93 locations

# 3. Full recommendation
curl -X POST https://zomato-ai.up.railway.app/api/recommend \
  -H "Content-Type: application/json" \
  -d '{"location":"Koramangala","cuisines":["North Indian"],"budget":"medium","min_rating":4.0}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['mode'], len(d['recommendations']), 'results')"
# Expected: llm 5 results

# 4. Open the frontend
open https://your-app.vercel.app
```

---

## Environment Variables Reference

### Railway (backend)

| Variable | Required | Default | Description |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ Yes | — | Groq API key |
| `GROQ_MODEL` | No | `openai/gpt-oss-120b` | LLM model |
| `MAX_CANDIDATES` | No | `20` | Max restaurants sent to LLM |
| `TOP_K` | No | `5` | Recommendations to return |
| `ALLOWED_ORIGINS` | ✅ Yes | — | Vercel frontend URL(s), comma-separated |
| `LOG_LEVEL` | No | `INFO` | Logging verbosity |
| `CACHE_DIR` | No | `data/cache` | Parquet cache location |

### Vercel (frontend)

| Variable | Required | Description |
|---|---|---|
| `VITE_API_URL` | ✅ Yes (prod) | Full Railway backend URL, no trailing slash |

---

## Redeployment

| Scenario | Action |
|---|---|
| Code change | Push to `main` → both Vercel and Railway auto-redeploy |
| Rotate Groq key | Update `GROQ_API_KEY` in Railway → auto-redeploy |
| New Vercel domain | Add to `ALLOWED_ORIGINS` in Railway |
| Refresh dataset | SSH into Railway shell and run `python app.py --refresh`, or add a `/api/refresh` endpoint |
| Scale up | Railway: upgrade to Hobby tier for always-on + more RAM |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `CORS error` in browser | `ALLOWED_ORIGINS` missing Vercel URL | Update Railway env var |
| `503 Dataset not loaded` | Railway cold start in progress | Wait 30s, retry |
| `401` from Groq | Expired/wrong API key | Update `GROQ_API_KEY` in Railway |
| Frontend shows blank page | `VITE_API_URL` wrong or missing | Check Vercel env var, redeploy |
| Recommendations always degraded | Groq rate limit on free tier | Wait and retry, or upgrade Groq plan |
