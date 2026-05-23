// api/store.js
// Vercel serverless function — reads and writes a household's data to Upstash Redis.
//
// GET  /api/store?code=<household>          → returns { library, week, list }
// POST /api/store  body { code, library, week, list }  → saves the household state

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

function isValidCode(code) {
  // Reasonable bounds: 4-64 chars, letters/numbers/dash/underscore only
  return typeof code === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(code);
}

function key(code) {
  return `menu:household:${code}`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const code = req.query?.code;
      if (!isValidCode(code)) {
        return res.status(400).json({ error: "Invalid household code." });
      }
      const data = await redis.get(key(code));
      if (!data) {
        // New household — return empty defaults so the client doesn't have to special-case
        return res.status(200).json({ library: [], week: {}, list: [], cleaning: [], pharmacy: [], books: [] });
      }
      // @upstash/redis auto-parses JSON; data is already an object
      return res.status(200).json({
        library: data.library || [],
        week: data.week || {},
        list: data.list || [],
        cleaning: data.cleaning || [],
        pharmacy: data.pharmacy || [],
        books: data.books || [],
      });
    }

    if (req.method === "POST") {
      const { code, library, week, list, cleaning, pharmacy, books } = req.body || {};
      if (!isValidCode(code)) {
        return res.status(400).json({ error: "Invalid household code." });
      }
      const payload = {
        library: Array.isArray(library) ? library : [],
        week: week && typeof week === "object" ? week : {},
        list: Array.isArray(list) ? list : [],
        cleaning: Array.isArray(cleaning) ? cleaning : [],
        pharmacy: Array.isArray(pharmacy) ? pharmacy : [],
        books: Array.isArray(books) ? books : [],
        _updatedAt: Date.now(),
      };
      // @upstash/redis auto-serializes objects via JSON
      await redis.set(key(code), payload);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Store endpoint failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
