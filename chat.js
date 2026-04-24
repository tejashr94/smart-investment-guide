// =============================================================
// api/chat.js — Vercel Serverless Function
//
// This function runs on Vercel's edge servers, NOT in the browser.
// It reads GEMINI_API_KEY from Vercel Environment Variables and
// forwards the request to Google Gemini, keeping the key secret.
//
// Browser  →  POST /api/chat  →  this function  →  Gemini API
//                                                       ↓
// Browser  ←  JSON response   ←  this function  ←  Gemini API
// =============================================================

export default async function handler(req, res) {

  // ── CORS Headers ─────────────────────────────────────────────
  // Allow requests from any origin (adjust in production).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle pre-flight OPTIONS request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ── Only allow POST ──────────────────────────────────────────
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // ── Read API key from Vercel Environment Variables ───────────
  // Set this in: Vercel Dashboard → Project → Settings → Environment Variables
  // Variable name: GEMINI_API_KEY
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY environment variable is not set.");
    return res.status(500).json({
      error: "Server configuration error: API key not set. " +
             "Add GEMINI_API_KEY in Vercel Environment Variables.",
    });
  }

  // ── Read model from env or fall back to default ──────────────
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const GEMINI_URL   =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  // ── Forward the request body to Gemini ───────────────────────
  try {
    const geminiResponse = await fetch(GEMINI_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(req.body),   // pass through exactly what the browser sent
    });

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      // Forward Gemini's error status + message to the browser
      return res.status(geminiResponse.status).json({
        error: data?.error?.message || `Gemini API error: HTTP ${geminiResponse.status}`,
      });
    }

    // ── Return Gemini's response to the browser ─────────────────
    return res.status(200).json(data);

  } catch (err) {
    console.error("Proxy fetch error:", err);
    return res.status(500).json({ error: `Proxy error: ${err.message}` });
  }
}
