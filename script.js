/*
  script.js
  ---------
  Main logic for the Investment Diversification chatbot.

  What this file does:
    1. Reads the user's portfolio description from the chat box.
    2. Runs a quick keyword check — if the topic isn't related to
       investing, we reject it instantly without wasting an API call.
    3. Sends qualifying messages to our /api/chat backend route,
       which forwards them securely to Google Gemini.
    4. Strips any markdown formatting from the AI's reply so it
       displays as clean plain text.
    5. Persists the conversation in sessionStorage so it survives
       a page refresh (but clears when the tab is closed).
    6. Supports English and Hindi via a toggle in the header.
*/

"use strict";

/* ==============================================================
   GRAB DOM ELEMENTS
   Caching these once up-front avoids repeated querySelector
   calls every time a message is sent.
   ============================================================== */
const msgFeed       = document.getElementById("chatMessages");
const inputBox      = document.getElementById("userInput");
const submitBtn     = document.getElementById("sendBtn");
const thinkingBar   = document.getElementById("typingIndicator");
const letterCount   = document.getElementById("charCount");
const statusCircle  = document.getElementById("statusDot");
const statusLabel   = document.getElementById("statusText");

/* ==============================================================
   SESSION MEMORY
   We store the chat history in sessionStorage so the conversation
   survives a page reload. When the user closes the tab the browser
   automatically wipes sessionStorage — no stale data.
   ============================================================== */
const HISTORY_KEY = "invest_advisor_history";
const LANG_KEY    = "invest_advisor_lang";

const chatHistory = [];   /* runtime array, pushed to before every API call */

function persistHistory() {
  /* Try to save — silently skip if storage quota is exceeded */
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(chatHistory));
  } catch (_) {}
}

function restoreHistory() {
  /* Pull back whatever was saved in a previous page load */
  try {
    const data = sessionStorage.getItem(HISTORY_KEY);
    if (data) {
      const arr = JSON.parse(data);
      if (Array.isArray(arr) && arr.length > 0) {
        chatHistory.push(...arr);
        return true;   /* signals that we have a session to replay */
      }
    }
  } catch (_) {}
  return false;
}

function resetChat() {
  /* Wipe history array, clear storage, empty the feed, show fresh greeting */
  chatHistory.length = 0;
  sessionStorage.removeItem(HISTORY_KEY);
  msgFeed.innerHTML = "";
  showGreeting();
}

/* ==============================================================
   LANGUAGE SUPPORT (ENGLISH / HINDI)
   The active language is remembered between page loads.
   Switching language injects a language-rule instruction into the
   Gemini system prompt so the model responds in the right language.
   ============================================================== */
let activeLang = sessionStorage.getItem(LANG_KEY) || "en";

/* All strings that need to change when language switches */
const LANG_STRINGS = {
  en: {
    inputHint:   "e.g. I have 60% stocks, 30% FD, 10% gold — how should I diversify?",
    rejected:    "I am not answerable to these questions. Please ask about Smart Investment Diversification.",
    clearLabel:  "Clear Session",
    langBtnText: "हिं",          /* shows the language to switch TO */
    botName:     "Advisor",
    userName:    "You",
    /* tells Gemini which language to respond in */
    responseRule: "Always respond in clear, simple English regardless of the user's input language.",
    /* message shown in chat after switching */
    switchNotice: "Language switched to English. You can now ask questions in English.",
    sessionNote:  "Previous session restored.",
  },
  hi: {
    inputHint:   "उदा. मेरे पास 60% शेयर, 30% FD, 10% सोना है — मुझे कैसे diversify करना चाहिए?",
    rejected:    "मैं इन प्रश्नों का उत्तर देने में असमर्थ हूँ। कृपया Smart Investment Diversification से संबंधित प्रश्न पूछें।",
    clearLabel:  "सत्र साफ करें",
    langBtnText: "EN",
    botName:     "सलाहकार",
    userName:    "आप",
    responseRule: "Always respond entirely in Hindi using Devanagari script. Keep well-known financial terms in English (equity, SIP, ETF, REIT) but explain them in Hindi.",
    switchNotice: "भाषा हिंदी में बदल दी गई है। अब आप हिंदी में प्रश्न पूछ सकते हैं।",
    sessionNote:  "पिछला सत्र पुनः लोड किया गया।",
  },
};

/* Shorthand to get the current language strings */
const lang = () => LANG_STRINGS[activeLang];

function swapLanguage() {
  /* Flip between en and hi, save the choice, refresh the UI labels */
  activeLang = activeLang === "en" ? "hi" : "en";
  sessionStorage.setItem(LANG_KEY, activeLang);
  refreshLangUI();
  addBubble("bot", lang().switchNotice);
}

function refreshLangUI() {
  /* Update placeholder text and header button label when language changes */
  inputBox.placeholder = lang().inputHint;
  const toggleBtn = document.getElementById("langToggle");
  if (toggleBtn) toggleBtn.textContent = lang().langBtnText;
  const clrBtn = document.getElementById("clearBtn");
  if (clrBtn) clrBtn.title = lang().clearLabel;
}

/* ==============================================================
   GEMINI SYSTEM PROMPT
   This is the instruction we send to Gemini before every
   conversation. It defines exactly what the AI is allowed to
   talk about and forces a structured 4-part answer format for
   any portfolio query. Language rule is appended freshly so
   switching language mid-chat takes effect immediately.
   ============================================================== */
const ADVISOR_PROMPT = `You are a specialised Smart Investment Diversification Advisor. Your role is to help users analyse their investment portfolios and suggest diversification strategies.

You are ONLY allowed to discuss:
- Portfolio analysis and current allocation review
- Asset class diversification: equity (large-cap, mid-cap, small-cap, international), debt (government bonds, corporate bonds, fixed deposits), real estate (REITs), mutual funds, commodities (gold, silver), cryptocurrency as a small allocation
- Sector and geographic diversification
- Risk profiling: conservative, moderate, aggressive
- Rebalancing strategies and timing
- Investment vehicles: ETFs, index funds, SIPs, REITs, bonds
- Tax-efficient investing concepts
- Common portfolio mistakes

When a user shares portfolio details (e.g. "I have 70% stocks, 30% bonds"), respond in this exact 4-part plain-text format:

Part 1 - Current Allocation Summary:
Summarise what the user holds and identify the dominant exposure.

Part 2 - Risk and Gap Analysis:
List 2 to 4 specific risks such as concentration risk, missing inflation hedge, no international exposure, or high correlation.

Part 3 - Diversification Strategy:
Recommend a target allocation with percentages across domestic equity, international equity, debt, real estate, gold, and any alternatives. Explain why each change helps.

Part 4 - Action Steps:
Give 3 to 5 numbered, specific next steps. Name real instruments like Nifty 50 ETF, government bond fund, Sovereign Gold Bond, or a REIT mutual fund.

Example: For "70% stocks, 30% bonds" suggest something like: 45% domestic equity, 15% international equity, 20% debt, 10% gold, 10% real estate.

For general investment questions, give a concise educational answer using the same format.

Rules:
1. If the question is not about investing or portfolio management, respond ONLY with the rejection message — no extra text.
2. Never use markdown formatting: no asterisks, hashes, underscores, backticks, or block quotes.
3. Use only numbered lists. No hyphens or asterisks as bullets.
4. Skip filler phrases like "Great question!" or "Certainly!".
5. Keep portfolio answers under 350 words. General answers under 200 words.
6. End every on-topic answer with: "Note: This is educational information only. Please consult a certified financial advisor before making investment decisions."`;

function buildPromptWithLang() {
  /* Attach the language instruction on each API call so it's always current */
  return ADVISOR_PROMPT + "\n\nLANGUAGE INSTRUCTION: " + lang().responseRule;
}

/* ==============================================================
   TOPIC FILTER (DOMAIN GUARD)
   Before making any API call, we scan the user's message for
   investment-related keywords. If none are found, we reply
   immediately with a rejection message. This saves API quota and
   gives an instant response for obviously off-topic questions.
   ============================================================== */
const TOPIC_KEYWORDS = [
  /* Core investing terms */
  "invest", "portfolio", "stock", "bond", "etf", "fund", "mutual fund",
  "asset", "allocat", "diversif", "rebalanc", "equity", "dividend",
  /* Asset types */
  "real estate", "reit", "commodity", "commodities", "gold", "silver",
  "crypto", "bitcoin", "index fund", "fixed deposit", "fd", "ppf",
  "nps", "sip", "elss", "nifty", "sensex", "large cap", "mid cap",
  "small cap", "debt fund", "liquid fund", "hybrid fund", "bluechip",
  /* Risk and strategy words */
  "risk", "return", "volatility", "hedge", "rebalance", "correlation",
  "concentration", "exposure", "weightage", "holding", "sector",
  "market", "bear", "bull", "inflation", "recession",
  /* Financial metrics */
  "yield", "interest rate", "expense ratio", "nav", "cagr", "xirr",
  "capital gain", "tax", "retirement", "401k", "ira", "pension",
  "financial", "finance", "wealth", "saving", "share", "securities",
  /* Geographic context */
  "international", "emerging market", "developed market", "global",
  "domestic", "foreign", "us market", "indian market",
  /* User action phrases */
  "strategy", "strategies", "how to invest", "where to invest",
  "should i invest", "how much", "percentage", "allocation",
  "balance", "beginner", "advanced", "suggest", "recommend",
  "analyze", "analysis", "review my", "look at my",
  /* Natural ways someone might describe their portfolio */
  "i have", "i hold", "my portfolio", "i own", "i put", "i invested",
  "i am investing", "i want to invest", "currently invested",
];

function isOnTopic(userText) {
  const lower = userText.toLowerCase();
  return TOPIC_KEYWORDS.some(kw => lower.includes(kw));
}

/* ==============================================================
   MARKDOWN CLEANER
   Even though we tell Gemini not to use markdown, it sometimes
   sneaks in asterisks or hashes. This function strips them all
   out before displaying the response so the UI stays clean.
   ============================================================== */
function cleanResponse(rawText) {
  return rawText
    .replace(/```[\s\S]*?```/g, "")          /* remove fenced code blocks */
    .replace(/^#{1,6}\s+/gm, "")             /* remove heading markers */
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1") /* remove bold/italic stars */
    .replace(/_{1,3}([^_\n]+)_{1,3}/g, "$1")   /* remove underline markers */
    .replace(/`([^`\n]+)`/g, "$1")           /* remove inline code ticks */
    .replace(/^>\s+/gm, "")                  /* remove blockquote markers */
    .replace(/^[ \t]*[-*+]\s+/gm, "")        /* remove bullet markers */
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "") /* remove horizontal rules */
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") /* convert links to plain text */
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")    /* strip image tags entirely */
    .replace(/\n{3,}/g, "\n\n")              /* collapse excessive blank lines */
    .trim();
}

/* ==============================================================
   TIMESTAMP HELPER
   Used to show "10:34 AM" style time below each bubble.
   ============================================================== */
function currentTime() {
  return new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/* ==============================================================
   ADD BUBBLE
   Creates and appends a chat bubble to the message feed.
   role: "user" OR "bot"
   isErr: true turns the bubble red for error messages
   ============================================================== */
function addBubble(role, text, isErr = false) {
  const fromUser = role === "user";

  /* Outer row wrapper */
  const row = document.createElement("div");
  row.className = `chat-msg ${fromUser ? "user-msg" : "bot-msg"}`;

  /* Small circular avatar showing "You" or "AI" */
  const avatar = document.createElement("div");
  avatar.className = "avatar-circle";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = fromUser ? lang().userName : "AI";

  /* Column that holds sender name, bubble, and timestamp */
  const col = document.createElement("div");
  col.className = "bubble-wrap";

  const nameTag = document.createElement("span");
  nameTag.className = "sender-name";
  nameTag.textContent = fromUser ? lang().userName : lang().botName;

  /* The actual message bubble */
  const bubble = document.createElement("div");
  bubble.className = `bubble-text${isErr ? " has-error" : ""}`;
  bubble.textContent = text;   /* always textContent, never innerHTML — prevents XSS */

  const time = document.createElement("span");
  time.className = "msg-timestamp";
  time.textContent = currentTime();

  col.appendChild(nameTag);
  col.appendChild(bubble);
  col.appendChild(time);
  row.appendChild(avatar);
  row.appendChild(col);

  msgFeed.appendChild(row);
  scrollDown();

  return bubble;
}

function scrollDown() {
  msgFeed.scrollTo({ top: msgFeed.scrollHeight, behavior: "smooth" });
}

/* ==============================================================
   THINKING INDICATOR CONTROLS
   Show/hide the animated dots while waiting for the API.
   ============================================================== */
function showThinking() {
  thinkingBar.classList.remove("hidden");
  scrollDown();
}

function hideThinking() {
  thinkingBar.classList.add("hidden");
}

/* ==============================================================
   STATUS BADGE
   Changes the green "Online" dot to amber "Thinking..." while
   the API request is in flight, then resets when done.
   ============================================================== */
function setStatusBadge(mode) {
  if (mode === "busy") {
    statusCircle.style.background        = "#F59E0B";  /* amber */
    statusLabel.style.color              = "#D97706";
    statusLabel.textContent              = "Thinking…";
    statusCircle.style.animationDuration = "0.5s";     /* faster pulse */
  } else {
    statusCircle.style.background        = "#10B981";  /* green */
    statusLabel.style.color              = "#059669";
    statusLabel.textContent              = "Online";
    statusCircle.style.animationDuration = "2s";
  }
}

/* ==============================================================
   GEMINI API REQUEST
   Sends the user's message (plus conversation history for context)
   to our /api/chat proxy endpoint. The proxy runs on Vercel servers
   and holds the secret API key — the browser never sees it.

   Flow: browser → POST /api/chat → Vercel function → Gemini → back
   ============================================================== */
async function fetchAIReply(userMessage) {

  /* Build the full conversation as the Gemini "contents" array.
     We include recent history so the AI has context for follow-ups. */
  const conversationPayload = chatHistory.map(entry => ({
    role:  entry.role,
    parts: [{ text: entry.text }],
  }));

  /* Append the current user turn at the end */
  conversationPayload.push({ role: "user", parts: [{ text: userMessage }] });

  /* Full request payload — same structure the Gemini API expects,
     forwarded as-is by our /api/chat serverless function. */
  const payload = {
    system_instruction: {
      parts: [{ text: buildPromptWithLang() }],   /* language-aware prompt */
    },
    contents: conversationPayload,
    generationConfig: {
      temperature:     SETTINGS.TEMP,
      topP:            SETTINGS.NUCLEUS_P,
      topK:            SETTINGS.TOP_K_VAL,
      maxOutputTokens: SETTINGS.MAX_TOKENS,
      candidateCount:  SETTINGS.NUM_CANDIDATES,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  /* POST to the backend proxy — key stays server-side */
  const res = await fetch(SETTINGS.PROXY_ENDPOINT, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error || `HTTP ${res.status}`);
  }

  const data = await res.json();

  /* Extract the text from the response — fall back if something is missing */
  const rawReply = data?.candidates?.[0]?.content?.parts?.[0]?.text
    || "I could not generate a response. Please try again.";

  return cleanResponse(rawReply);
}

/* ==============================================================
   MAIN SEND HANDLER
   Called when the user clicks Send or presses Enter.
   Full flow:
     1. Read and display the user's message
     2. Topic check — reject off-topic questions immediately
     3. Show thinking indicator, call the API
     4. Display the cleaned AI response
   ============================================================== */
async function handleSend() {
  const userText = inputBox.value.trim();
  if (!userText || submitBtn.disabled) return;

  /* Show the user's message in the chat and add it to history */
  addBubble("user", userText);
  chatHistory.push({ role: "user", text: userText });
  persistHistory();   /* save after each message so nothing is lost on refresh */

  /* Clear the input field and disable Send until a response arrives */
  inputBox.value = "";
  resizeInput();
  refreshCharCount();
  submitBtn.disabled = true;

  /* Quick domain check — no need to call the API for off-topic questions */
  if (!isOnTopic(userText)) {
    const rejection = lang().rejected;
    addBubble("bot", rejection);
    chatHistory.push({ role: "model", text: rejection });
    persistHistory();
    submitBtn.disabled = false;
    inputBox.focus();
    return;
  }

  /* Show the animated thinking dots while we wait for Gemini */
  showThinking();
  setStatusBadge("busy");

  try {
    const reply = await fetchAIReply(userText);

    hideThinking();
    setStatusBadge("online");

    /* Add the AI's reply to the chat and save it to session */
    addBubble("bot", reply);
    chatHistory.push({ role: "model", text: reply });
    persistHistory();

    /* Cap history at 20 entries (10 pairs) to avoid the payload growing too large */
    if (chatHistory.length > 20) {
      chatHistory.splice(0, 2);
      persistHistory();
    }

  } catch (err) {
    hideThinking();
    setStatusBadge("online");
    console.error("API error:", err);
    addBubble("bot", `Error: ${err.message}. Check your API key and try again.`, true);
  } finally {
    submitBtn.disabled = false;
    inputBox.focus();
  }
}

/* ==============================================================
   TEXTAREA RESIZE
   Auto-expands the textarea as the user types, up to a max height.
   Feels much more natural than a fixed-height input for longer text.
   ============================================================== */
function resizeInput() {
  inputBox.style.height = "auto";
  inputBox.style.height = Math.min(inputBox.scrollHeight, 130) + "px";
}

/* Updates the "84 / 2000" character counter, turns amber near the limit */
function refreshCharCount() {
  const n = inputBox.value.length;
  letterCount.textContent = `${n} / 2000`;
  letterCount.style.color = n > 1800 ? "#F59E0B" : "";
}

/* ==============================================================
   INPUT EVENT LISTENERS
   Keep the textarea, character counter, and send button in sync.
   ============================================================== */
inputBox.addEventListener("input", () => {
  resizeInput();
  refreshCharCount();
  /* Only enable Send if there's actual content */
  submitBtn.disabled = inputBox.value.trim().length === 0;
});

inputBox.addEventListener("keydown", e => {
  /* Enter alone sends; Shift+Enter creates a new line */
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

submitBtn.addEventListener("click", handleSend);

/* ==============================================================
   CHIP PREFILL
   When the user clicks one of the scenario chip buttons in the HTML,
   this fills the textarea with a ready-to-send portfolio question.
   ============================================================== */
function prefillInput(scenarioText) {
  inputBox.value = scenarioText;
  resizeInput();
  refreshCharCount();
  submitBtn.disabled = false;
  inputBox.focus();
}

/* ==============================================================
   GREETING MESSAGE
   Shown on first load or after clearing the chat.
   Written as a DOM manipulation rather than innerHTML to keep
   things safe and consistent with the rest of the bubbles.
   ============================================================== */
function showGreeting() {
  const row = document.createElement("div");
  row.className = "chat-msg bot-msg welcome-msg";

  const avatar = document.createElement("div");
  avatar.className = "avatar-circle";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "AI";

  const col = document.createElement("div");
  col.className = "bubble-wrap";

  const nameTag = document.createElement("span");
  nameTag.className = "sender-name";
  nameTag.textContent = lang().botName;

  const bubble = document.createElement("div");
  bubble.className = "bubble-text";
  /* Introductory message explains what the chatbot can do */
  bubble.textContent =
    "Hello! I am your Smart Investment Diversification Advisor. " +
    "Share your current portfolio and I will analyse it for you. " +
    "Try something like: 'I have 70% in stocks and 30% in fixed deposits — " +
    "how should I diversify?' " +
    "I can spot concentration risks, suggest allocations across equity, debt, " +
    "real estate, and gold, and give you specific action steps. " +
    "You can also ask general questions about rebalancing, asset classes, " +
    "or diversification strategies.";

  const time = document.createElement("span");
  time.className = "msg-timestamp";
  time.textContent = currentTime();

  col.appendChild(nameTag);
  col.appendChild(bubble);
  col.appendChild(time);
  row.appendChild(avatar);
  row.appendChild(col);

  msgFeed.appendChild(row);
}

/* ==============================================================
   STARTUP
   1. Apply the saved language preference to the UI.
   2. Try to restore a previous session from sessionStorage.
   3. If a session exists, replay the bubbles and show a notice.
   4. Otherwise just show the fresh greeting message.
   ============================================================== */
refreshLangUI();

const sessionFound = restoreHistory();

if (sessionFound) {
  /* Replay each saved message so the user sees their previous chat */
  chatHistory.forEach(entry => {
    const role = entry.role === "model" ? "bot" : "user";
    addBubble(role, entry.text);
  });

  /* Small pill notice at the bottom letting them know it was restored */
  const notice = document.createElement("p");
  notice.className = "session-banner";
  notice.textContent = lang().sessionNote;
  msgFeed.appendChild(notice);
  scrollDown();
} else {
  showGreeting();
}

inputBox.focus();
