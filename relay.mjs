// Local WebSocket relay: browser <-> ws://localhost:3031 <-> Deepgram agent.
// Keeps DEEPGRAM_API_KEY on the server, and works with keys that cannot mint
// temporary tokens (/v1/auth/grant needs a Member-or-higher key).
import nextEnv from "@next/env";
import { WebSocket, WebSocketServer } from "ws";

nextEnv.loadEnvConfig(process.cwd(), true);
const KEY = process.env.DEEPGRAM_API_KEY;
const PORT = Number(process.env.RELAY_PORT || 3031);
const UPSTREAM = "wss://agent.deepgram.com/v1/agent/converse";

const server = new WebSocketServer({ port: PORT, host: "127.0.0.1" });
server.on("connection", (client) => {
  if (!KEY) return client.close(4001, "DEEPGRAM_API_KEY is not set");
  const upstream = new WebSocket(UPSTREAM, { headers: { Authorization: `Token ${KEY}` } });
  const queue = [];
  upstream.on("open", () => queue.splice(0).forEach((m) => upstream.send(m.data, { binary: m.binary })));
  client.on("message", (data, binary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
    else queue.push({ data, binary });
  });
  upstream.on("message", (data, binary) => client.readyState === WebSocket.OPEN && client.send(data, { binary }));
  const closeCode = (c) => (c >= 3000 && c <= 4999) || c === 1000 ? c : 1011;
  upstream.on("close", (code, reason) => client.readyState === WebSocket.OPEN && client.close(closeCode(code), reason.toString().slice(0, 120)));
  upstream.on("unexpected-response", (_req, res) => client.close(4002, `Deepgram refused the session (HTTP ${res.statusCode})`));
  upstream.on("error", () => {});
  client.on("close", () => upstream.close());
});
console.log(`Deepgram relay on ws://127.0.0.1:${PORT}`);
