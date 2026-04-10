import path from "node:path";
import Fastify from "fastify";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import "./db.js";
import { config, paths } from "./config.js";
import { repository } from "./services/repository.js";
import { buildOutboundTwiML, startOutboundCall } from "./services/telephony.js";
import { VoiceBridgeSession } from "./services/voiceBridge.js";

const app = Fastify({
  logger: true
});

await app.register(formbody);
await app.register(websocket);
await app.register(fastifyStatic, {
  root: paths.webDir,
  prefix: "/"
});

app.get("/", async (_request, reply) => {
  return reply.sendFile("index.html");
});

app.get("/health", async () => ({
  ok: true,
  now: new Date().toISOString()
}));

app.get("/api/elders", async () => {
  return repository.listElders().map((elder) => ({
    ...elder,
    memory: repository.buildMemorySnapshot(elder.id)
  }));
});

app.get("/api/elders/:id", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const elder = repository.getElder(params.id);
  if (!elder) {
    return reply.status(404).send({ error: "Not found" });
  }

  return {
    ...elder,
    memory: repository.buildMemorySnapshot(elder.id)
  };
});

app.post("/api/elders", async (request, reply) => {
  const body = z.object({
    full_name: z.string().min(1),
    phone_number: z.string().min(5),
    timezone: z.string().min(1),
    medication_plan: z.string().min(1),
    baseline_summary: z.string().min(1),
    risk_level: z.string().default("low")
  }).parse(request.body);

  const id = `elder-${body.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const elder = repository.createElder({
    id,
    ...body
  });

  return reply.status(201).send(elder);
});

app.get("/api/conversations", async () => {
  return repository.listRecentConversations(25);
});

app.post("/api/elders/:id/call", async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const elder = repository.getElder(params.id);
  if (!elder) {
    return reply.status(404).send({ error: "Not found" });
  }

  const conversation = repository.createConversation(elder.id);
  try {
    const call = await startOutboundCall(elder.id, elder.phone_number, conversation!.id);

    repository.updateConversation(conversation!.id, {
      status: "dialing",
      twilio_call_sid: call.sid
    });

    return {
      conversationId: conversation!.id,
      callSid: call.sid,
      status: "dialing"
    };
  } catch (error) {
    repository.updateConversation(conversation!.id, {
      status: "failed",
      ended_at: new Date().toISOString()
    });

    return reply.status(502).send({
      error: error instanceof Error ? error.message : "Failed to start call."
    });
  }
});

app.post("/twilio/voice/outbound", async (request, reply) => {
  const query = z.object({
    elderId: z.string(),
    conversationId: z.string()
  }).parse(request.query);

  const streamUrl = new URL("/ws/twilio-media", config.PUBLIC_BASE_URL);
  const twiml = buildOutboundTwiML(
    streamUrl.toString().replace("https://", "wss://").replace("http://", "ws://"),
    query.elderId,
    query.conversationId
  );

  return reply.type("text/xml").send(twiml);
});

app.post("/twilio/status", async (request) => {
  const query = z.object({
    conversationId: z.string()
  }).parse(request.query);

  const body = z.object({
    CallStatus: z.string().optional(),
    CallSid: z.string().optional()
  }).parse(request.body);

  repository.updateConversation(query.conversationId, {
    status: body.CallStatus ?? "updated",
    twilio_call_sid: body.CallSid ?? null,
    ended_at: body.CallStatus === "completed" ? new Date().toISOString() : null
  });

  return { ok: true };
});

app.get("/api/dashboard", async () => {
  const elders = repository.listElders();
  const conversations = repository.listRecentConversations(10);

  const highRisk = elders.filter((elder) => elder.risk_level === "high" || elder.risk_level === "urgent").length;

  return {
    totalElders: elders.length,
    activeCalls: conversations.filter((conversation) => conversation.status === "active").length,
    highRisk,
    recentConversations: conversations
  };
});

app.get("/ws/twilio-media", { websocket: true }, (connection) => {
  const socket = "socket" in connection ? connection.socket : connection;
  const session = new VoiceBridgeSession(socket);

  socket.on("message", (raw) => {
    session.handleTwilioMessage(raw.toString());
  });
});

app.setNotFoundHandler(async (request, reply) => {
  if (request.raw.method === "GET" && !path.extname(request.raw.url || "")) {
    return reply.sendFile("index.html");
  }

  return reply.status(404).send({ error: "Not found" });
});

await app.listen({
  port: config.PORT,
  host: "0.0.0.0"
});
