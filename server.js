"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY_BYTES = 18 * 1024 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

loadLocalEnvironment();

function loadLocalEnvironment() {
  const filePath = path.join(ROOT, ".env");
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith("#") || process.env[match[1]]) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
      "media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("The request is too large."), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("The request could not be read."), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function cleanText(value, limit = 240) {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u2600-\u27BF\u2300-\u23FF\uFE0F\u20E3\u200D]/gu, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, limit);
}

function cleanList(value, limit = 3) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, 200)).filter(Boolean).slice(0, limit);
}

function safePercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseImageDataUrl(value) {
  if (typeof value !== "string") throw Object.assign(new Error("Choose a photo first."), { statusCode: 400 });
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) throw Object.assign(new Error("Choose a JPG, PNG, or WebP photo."), { statusCode: 400 });
  const mimeType = match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8) {
    throw Object.assign(new Error("This photo is too large. Choose a smaller photo."), { statusCode: 413 });
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("This photo is too large or cannot be read."), { statusCode: 413 });
  }
  return { mimeType, base64, bytes };
}

function readModelObject(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The plant check did not return a report.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function makeReport(data) {
  const allowedStatuses = new Set(["healthy", "possible_issue", "likely_diseased", "uncertain"]);
  const allowedQuality = new Set(["good", "poor", "uncertain"]);
  const status = allowedStatuses.has(data.health_status) ? data.health_status : "uncertain";
  const quality = allowedQuality.has(data.image_quality) ? data.image_quality : "uncertain";
  const causes = Array.isArray(data.possible_causes)
    ? data.possible_causes.slice(0, 3).map((item) => ({
        name: cleanText(item?.name, 120),
        reason: cleanText(item?.evidence || item?.reason, 220),
      })).filter((item) => item.name)
    : [];
  const treatments = Array.isArray(data.treatment_candidates_for_review)
    ? data.treatment_candidates_for_review.slice(0, 3).map((item) => ({
        name: cleanText(item?.name, 120),
        reason: cleanText(item?.reason, 220),
      })).filter((item) => item.name)
    : [];
  const followUp = cleanText(data.recommended_follow_up, 240);
  let nextAction = "CAPTURE_CLOSE_UP";
  if (quality === "good" && status === "healthy") nextAction = "CONTINUE_SCAN";
  if (quality === "good" && ["possible_issue", "likely_diseased"].includes(status)) nextAction = "FLAG_FOR_REVIEW";

  return {
    plant_type: cleanText(data.crop_name, 100) || "Unknown plant",
    health_status: status,
    confidence_percent: safePercent(data.confidence_percent),
    image_quality: quality,
    visible_signs: cleanList(data.visual_signs),
    possible_causes: causes,
    treatment_suggestions_for_local_review: treatments,
    next_step: followUp || "Take a closer photo and ask a local crop helper.",
    drone_record: {
      mode: "OBSERVE_ONLY",
      follow_up_action: nextAction,
      human_review_required: true,
      chemical_release_authorized: false,
      application_command: null,
    },
    checked_at: new Date().toISOString(),
  };
}

async function analyzePhoto(imageDataUrl) {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw Object.assign(new Error("The app needs setup. Ask the person who installed it."), { statusCode: 503 });

  const image = parseImageDataUrl(imageDataUrl);
  const prompt = [
    "Look carefully at this crop photo. Use very simple everyday English that a farmer can understand.",
    "Return only valid JSON, with no markdown, no extra words, and no emojis.",
    "Use exactly these fields: crop_name, health_status, confidence_percent, image_quality, visual_signs, possible_causes, treatment_candidates_for_review, recommended_follow_up.",
    "health_status must be healthy, possible_issue, likely_diseased, or uncertain. image_quality must be good, poor, or uncertain.",
    "Keep visible signs to 3 short items maximum. Each possible cause must have name and evidence. Each treatment suggestion must have name and reason.",
    "Only describe what can be seen. If the photo is unclear or several problems look alike, use uncertain and say what clearer photo is needed.",
    "Treatment suggestions are for a local crop helper to review. Do not give mixing amounts, spray amounts, chemical release steps, flight directions, target locations, or machine commands.",
    "Never tell a drone or device to spray, release, or apply anything. Do not assume a medicine is allowed for this crop.",
    "Example shape: {\"crop_name\":\"plant name\",\"health_status\":\"uncertain\",\"confidence_percent\":50,\"image_quality\":\"good\",\"visual_signs\":[],\"possible_causes\":[],\"treatment_candidates_for_review\":[],\"recommended_follow_up\":\"short next step\"}",
  ].join(" ");

  let response;
  try {
    response = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: image.mimeType, data: image.base64 } }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw Object.assign(new Error("There is no steady internet connection. Try again."), { statusCode: 502 });
  }

  if (!response.ok) {
    const messages = {
      400: "I could not use that photo. Choose another one.",
      401: "The app key was not accepted. Ask the person who installed it to check the setup.",
      403: "The app key was not accepted. Ask the person who installed it to check the setup.",
      429: "The plant check is busy. Wait a little, then try again.",
    };
    const message = messages[response.status] || (response.status >= 500
      ? "The plant check is not working now. Try again later."
      : "I could not finish the plant check. Try again.");
    throw Object.assign(new Error(message), { statusCode: response.status >= 500 ? 502 : 400 });
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw Object.assign(new Error("I could not read the plant report. Try again."), { statusCode: 502 });
  }
  const parts = result?.candidates?.[0]?.content?.parts || [];
  const answer = parts.filter((part) => typeof part?.text === "string" && !part.thought).map((part) => part.text).join("\n");
  if (!answer) throw Object.assign(new Error("I could not make the plant report. Try another clear photo."), { statusCode: 502 });

  try {
    return makeReport(readModelObject(answer));
  } catch {
    throw Object.assign(new Error("I could not make the plant report. Try another clear photo."), { statusCode: 502 });
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function handleRequest(req, res) {
  applySecurityHeaders(res);
  const requestUrl = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && requestUrl.pathname === "/api/status") {
    return sendJson(res, 200, { ready: Boolean((process.env.GEMINI_API_KEY || "").trim()) });
  }

  if (req.method === "POST" && requestUrl.pathname === "/api/analyze") {
    try {
      const body = await readJson(req);
      const report = await analyzePhoto(body.image);
      return sendJson(res, 200, report);
    } catch (error) {
      return sendJson(res, error.statusCode || 500, { error: error.message || "The plant check could not be completed." });
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "This action is not available." });
  }

  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep) && resolved !== path.join(PUBLIC_DIR, "index.html")) {
    return sendJson(res, 404, { error: "Page not found." });
  }
  try {
    const contents = await fs.promises.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(resolved).toLowerCase()] || "application/octet-stream",
      "Content-Length": contents.length,
      "Cache-Control": "no-cache",
    });
    return req.method === "HEAD" ? res.end() : res.end(contents);
  } catch {
    return sendJson(res, 404, { error: "Page not found." });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    if (!res.headersSent) sendJson(res, 500, { error: "Something went wrong. Please try again." });
    else res.destroy();
  });
});

const port = Number.parseInt(process.env.PORT || "3000", 10);
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Plant Check is ready at http://127.0.0.1:${port}\n`);
});

server.on("error", (error) => {
  process.stderr.write(`Plant Check could not start: ${error.message}\n`);
  process.exitCode = 1;
});
