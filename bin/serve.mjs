#!/usr/bin/env node
// vienna dashboard: a plain node:http server showing every rental's public record from state/.
// No framework, no build. http://localhost:8790
import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync } from "node:fs";
const DIR = new URL("../state/", import.meta.url).pathname;
const WEB = new URL("../web/", import.meta.url).pathname;
const PORT = Number(process.env.PORT ?? 8790);
createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/rentals") {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && !f.includes(".secrets.") && !f.includes(".wallets."));
    const all = files.map((f) => JSON.parse(readFileSync(DIR + f, "utf8"))).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(all));
  }
  const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[\w.-]+$/.test(file) || !existsSync(WEB + file)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": file.endsWith(".css") ? "text/css" : "text/html; charset=utf-8" }); res.end(readFileSync(WEB + file));
}).listen(PORT, () => console.log(`vienna dashboard on http://localhost:${PORT}`));
