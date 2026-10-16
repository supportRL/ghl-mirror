import "./env.js";
import http from "node:http";
import { mirrorContact, warmFieldMaps } from "./mirror.js";

const port = Number(process.env.PORT || 3000);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function send(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error("Request body is too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const path = (req.url || "/").split("?")[0];

  if (req.method === "GET" && path === "/health") {
    send(res, 200, { message: "ok" });
    return;
  }

  if (req.method !== "POST" || (path !== "/" && path !== "/mirror")) {
    send(res, 404, { message: "Route not found" });
    return;
  }

  try {
    const raw = await readBody(req);
    let body = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        send(res, 400, { message: "Request body must be JSON" });
        return;
      }
    }

    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) {
      send(res, 400, { message: "Email is required" });
      return;
    }
    if (!emailPattern.test(email)) {
      send(res, 400, { message: "Email is invalid" });
      return;
    }

    const result = await mirrorContact(email);
    console.log(`[mirror] ${email} -> ${result.body.message}`);
    send(res, result.statusCode, result.body);
  } catch (error) {
    const statusCode = error.statusCode || (error.status ? 502 : 500);
    const message = statusCode === 500 ? "Failed to mirror contact" : error.message;
    console.error(`[mirror] ${message}`);
    send(res, statusCode, {
      message: statusCode === 413 ? error.message : "Failed to mirror contact",
      ...(statusCode === 502 ? { detail: error.message } : {}),
    });
  }
});

const fieldStats = await warmFieldMaps();
server.listen(port, () => {
  console.log(
    `GHL mirror listening on http://localhost:${port} | shared custom fields: ${fieldStats.shared}/${fieldStats.enrollment}`,
  );
});
