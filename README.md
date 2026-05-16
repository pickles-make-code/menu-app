# Menu. — Recipe & Weekly Meal Planner

Dark-themed meal planning app with AI-powered recipe extraction from Instagram, TikTok and YouTube.

---

## Stack

- **Frontend**: React + Vite
- **Backend**: Vercel Serverless Functions (`/api/extract.js`)
- **Storage**: localStorage (per-browser) — swap to Firebase for cross-device sync
- **AI**: Claude Sonnet via Anthropic API
- **Recipe extraction**: cooking.guru (server-side, no CORS)

---

## Deploy to Vercel (step by step)

### 1. Get your Anthropic API key
- Go to [console.anthropic.com](https://console.anthropic.com)
- Create an API key
- Copy it — you'll need it in step 4

### 2. Push to GitHub
```bash
cd menu-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/menu-app.git
git push -u origin main
```

### 3. Connect to Vercel
- Go to [vercel.com](https://vercel.com) and sign in
- Click **Add New → Project**
- Import your `menu-app` GitHub repo
- Framework preset: **Vite** (Vercel detects this automatically)
- Leave all build settings as default

### 4. Add environment variables in Vercel
In your Vercel project → **Settings → Environment Variables**, add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | `sk-ant-...` (your key from step 1) |

Click **Save** then **Redeploy**.

### 5. Done
Your app is live at `https://menu-app-xxx.vercel.app`

Share that URL with anyone — works on phone and desktop.

---

## Local development

```bash
npm install
npm install -g vercel   # if not already installed

# Create .env.local from the example
cp .env.example .env.local
# Edit .env.local and add your ANTHROPIC_API_KEY

# Run Vite + Vercel dev server together
vercel dev
```

This runs the frontend on `http://localhost:3000` and the API functions on the same port — no CORS issues locally either.

---

## Upgrading storage to Firebase (optional)

Currently the app uses `localStorage` — data is per-browser and not shared across devices.

To enable cross-device sync:
1. Create a Firebase project at [console.firebase.google.com](https://console.firebase.google.com)
2. Enable **Firestore Database**
3. Enable **Authentication** (Google or anonymous)
4. Add your Firebase config to `.env.local` (see `.env.example`)
5. Replace `sget`/`sset` in `src/App.jsx` with Firestore reads/writes

---

## Project structure

```
menu-app/
├── api/
│   └── extract.js        ← Vercel serverless function (cooking.guru + Claude)
├── src/
│   ├── main.jsx           ← React entry point
│   └── App.jsx            ← Full app (Menu, Library, List, Import tabs)
├── public/
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── .env.example
```
