import WebSocket from "ws";
import { config, requireOpenAIConfig } from "../config.js";
import { repository } from "./repository.js";

type TwilioMessage =
  | { event: "connected"; protocol: string; version: string }
  | {
      event: "start";
      streamSid: string;
      start: {
        customParameters?: Record<string, string>;
        callSid: string;
        tracks: string[];
      };
    }
  | {
      event: "media";
      streamSid: string;
      media: {
        payload: string;
        chunk?: string;
        timestamp?: string;
      };
    }
  | { event: "stop"; streamSid: string }
  | { event: "dtmf"; streamSid: string; dtmf: { digits: string } }
  | { event: "mark"; streamSid: string; mark: { name: string } };

type ToolPayload = {
  mood?: string;
  compliance?: string;
  riskLevel?: string;
  summary?: string;
  notes?: string;
  medicationTaken?: boolean;
  symptoms?: string[];
  followUpNeeded?: boolean;
};

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function buildSystemInstructions(elderId: string) {
  const memory = repository.buildMemorySnapshot(elderId);
  if (!memory) {
    return [
      "You are a compassionate caregiver voice agent for elderly users.",
      "Speak naturally, warmly, and clearly in short conversational turns.",
      "Your top priorities are safety, medication adherence, mood check-ins, and escalating urgent concerns."
    ].join("\n");
  }

  const lastCalls = memory.lastCalls
    .map((call) => `- ${call.started_at}: mood=${call.mood}; compliance=${call.compliance}; risk=${call.risk_level}; summary=${call.summary}`)
    .join("\n");

  const events = memory.events
    .map((event) => `- ${event.created_at}: ${event.event_type}=${event.event_value}; ${event.notes}`)
    .join("\n");

  return [
    "You are a compassionate caregiver voice agent for elderly users.",
    "Speak naturally and with low-latency pacing. Use short spoken turns, ask one question at a time, and avoid sounding robotic.",
    "Your responsibilities are to check health, mood, medication adherence, hydration, and signs of confusion, distress, or escalation risk.",
    "If the caller expresses chest pain, breathing trouble, fall risk, self-harm, or medical emergency signs, calmly advise them to seek emergency help and mark risk as urgent.",
    "After meaningful updates, call the track_health_signal tool so the dashboard learns from this conversation.",
    "",
    `Patient profile: ${memory.elder.full_name}, timezone ${memory.elder.timezone}.`,
    `Medication plan: ${memory.elder.medication_plan}`,
    `Baseline summary: ${memory.elder.baseline_summary}`,
    `Current stored risk level: ${memory.elder.risk_level}`,
    "",
    "Recent calls:",
    lastCalls || "- No prior calls logged.",
    "",
    "Recent health events:",
    events || "- No prior health events logged."
  ].join("\n");
}

export class VoiceBridgeSession {
  private openAi?: WebSocket;
  private streamSid = "";
  private callSid = "";
  private elderId = "";
  private conversationId = "";
  private lastAssistantItemId = "";
  private currentResponseId = "";
  private assistantAudioBytesSent = 0;
  private transcriptChunks: string[] = [];

  constructor(private readonly telephonySocket: WebSocket) {}

  async connect() {
    requireOpenAIConfig();
    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.OPENAI_REALTIME_MODEL)}`;

    this.openAi = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    this.openAi.on("open", () => {
      if (!this.elderId) {
        return;
      }

      const memory = repository.buildMemorySnapshot(this.elderId);
      this.sendOpenAI({
        type: "session.update",
        session: {
          instructions: buildSystemInstructions(this.elderId),
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
          voice: config.OPENAI_REALTIME_VOICE,
          output_modalities: ["audio"],
          temperature: 0.8,
          turn_detection: {
            type: "server_vad",
            threshold: 0.45,
            prefix_padding_ms: 240,
            silence_duration_ms: 450
          },
          input_audio_transcription: {
            model: "gpt-4o-mini-transcribe",
            language: "es"
          },
          tools: [
            {
              type: "function",
              name: "track_health_signal",
              description: "Persist structured health, mood, medication adherence, and risk updates for the current elderly user.",
              parameters: {
                type: "object",
                properties: {
                  mood: { type: "string" },
                  compliance: { type: "string" },
                  riskLevel: { type: "string" },
                  summary: { type: "string" },
                  notes: { type: "string" },
                  medicationTaken: { type: "boolean" },
                  symptoms: {
                    type: "array",
                    items: { type: "string" }
                  },
                  followUpNeeded: { type: "boolean" }
                },
                additionalProperties: false
              }
            }
          ],
          tool_choice: "auto"
        }
      });

      this.sendOpenAI({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `The callee has just answered the phone. Greet ${memory?.elder.full_name ?? "the patient"} warmly in Spanish, introduce yourself as their caregiver assistant, and begin a short wellness check-in.`
            }
          ]
        }
      });
      this.sendOpenAI({ type: "response.create" });
    });

    this.openAi.on("message", (raw) => {
      const message = safeJsonParse<Record<string, unknown>>(raw.toString(), { type: "invalid" });
      this.handleOpenAIEvent(message);
    });

    this.openAi.on("close", () => {
      if (this.telephonySocket.readyState === WebSocket.OPEN) {
        this.telephonySocket.close();
      }
    });
  }

  handleTwilioMessage(raw: string) {
    const message = safeJsonParse<TwilioMessage | null>(raw, null);
    if (!message) {
      return;
    }

    if (message.event === "start") {
      this.streamSid = message.streamSid;
      this.callSid = message.start.callSid;
      this.elderId = message.start.customParameters?.elderId ?? "";
      this.conversationId = message.start.customParameters?.conversationId ?? "";

      repository.updateConversation(this.conversationId, {
        status: "active",
        twilio_call_sid: this.callSid,
        stream_sid: this.streamSid
      });

      if (!this.openAi || this.openAi.readyState !== WebSocket.OPEN) {
        void this.connect();
      }
      return;
    }

    if (message.event === "media") {
      this.sendOpenAI({
        type: "input_audio_buffer.append",
        audio: message.media.payload
      });
      return;
    }

    if (message.event === "dtmf") {
      repository.addHealthEvent({
        elderId: this.elderId,
        conversationId: this.conversationId,
        eventType: "dtmf",
        eventValue: message.dtmf.digits,
        notes: "Keypad input received during live call."
      });
      return;
    }

    if (message.event === "stop") {
      repository.updateConversation(this.conversationId, {
        status: "completed",
        ended_at: new Date().toISOString(),
        transcript: this.transcriptChunks.join("\n")
      });
      this.openAi?.close();
    }
  }

  private handleOpenAIEvent(event: Record<string, unknown>) {
    const type = String(event.type ?? "");

    if (type === "session.created") {
      const session = (event.session ?? {}) as Record<string, unknown>;
      repository.updateConversation(this.conversationId, {
        realtime_session_id: typeof session.id === "string" ? session.id : null
      });
      return;
    }

    if (type === "response.created") {
      const response = (event.response ?? {}) as Record<string, unknown>;
      this.currentResponseId = String(response.id ?? "");
      return;
    }

    if (type === "response.output_audio.delta") {
      const delta = String(event.delta ?? "");
      this.assistantAudioBytesSent += Buffer.from(delta, "base64").byteLength;
      this.sendTwilio({
        event: "media",
        streamSid: this.streamSid,
        media: { payload: delta }
      });
      return;
    }

    if (type === "response.output_item.added") {
      const item = (event.item ?? {}) as Record<string, unknown>;
      if (item.type === "message" && item.role === "assistant" && typeof item.id === "string") {
        this.lastAssistantItemId = item.id;
        this.assistantAudioBytesSent = 0;
      }
      return;
    }

    if (type === "response.audio_transcript.delta" || type === "response.output_audio_transcript.delta") {
      const delta = String(event.delta ?? "");
      if (delta) {
        this.transcriptChunks.push(`assistant: ${delta}`);
      }
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const transcript = String(event.transcript ?? "");
      if (transcript) {
        this.transcriptChunks.push(`user: ${transcript}`);
      }
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const name = String(event.name ?? "");
      const callId = String(event.call_id ?? "");
      const args = safeJsonParse<ToolPayload>(String(event.arguments ?? "{}"), {});

      if (name === "track_health_signal") {
        const result = this.applyHealthSignal(args);
        this.sendOpenAI({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: callId,
            output: JSON.stringify(result)
          }
        });
        this.sendOpenAI({ type: "response.create" });
      }
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      if (this.currentResponseId) {
        this.sendOpenAI({
          type: "response.cancel",
          response_id: this.currentResponseId
        });
      }

      if (this.lastAssistantItemId) {
        const playedMs = Math.round((this.assistantAudioBytesSent / 8000) * 1000);
        this.sendOpenAI({
          type: "conversation.item.truncate",
          item_id: this.lastAssistantItemId,
          content_index: 0,
          audio_end_ms: Math.max(0, playedMs)
        });
      }

      this.sendTwilio({
        event: "clear",
        streamSid: this.streamSid
      });
    }
  }

  private applyHealthSignal(payload: ToolPayload) {
    const current = repository.getConversation(this.conversationId);
    const nextSummary = payload.summary ?? current?.summary ?? "";
    const nextMood = payload.mood ?? current?.mood ?? "unknown";
    const nextCompliance = payload.compliance ?? current?.compliance ?? "unknown";
    const nextRisk = payload.riskLevel ?? current?.risk_level ?? "low";

    repository.updateConversation(this.conversationId, {
      summary: nextSummary,
      mood: nextMood,
      compliance: nextCompliance,
      risk_level: nextRisk,
      metadata_json: JSON.stringify({
        symptoms: payload.symptoms ?? [],
        followUpNeeded: Boolean(payload.followUpNeeded)
      })
    });

    if (payload.mood) {
      repository.addHealthEvent({
        elderId: this.elderId,
        conversationId: this.conversationId,
        eventType: "mood",
        eventValue: payload.mood,
        notes: payload.notes ?? ""
      });
    }

    if (payload.compliance) {
      repository.addHealthEvent({
        elderId: this.elderId,
        conversationId: this.conversationId,
        eventType: "medication_compliance",
        eventValue: payload.compliance,
        notes: payload.medicationTaken === undefined ? payload.notes ?? "" : `medicationTaken=${payload.medicationTaken}; ${payload.notes ?? ""}`
      });
    }

    if (payload.riskLevel) {
      repository.updateElderRisk(this.elderId, payload.riskLevel);
      repository.addHealthEvent({
        elderId: this.elderId,
        conversationId: this.conversationId,
        eventType: "risk_level",
        eventValue: payload.riskLevel,
        notes: payload.notes ?? ""
      });
    }

    for (const symptom of payload.symptoms ?? []) {
      repository.addHealthEvent({
        elderId: this.elderId,
        conversationId: this.conversationId,
        eventType: "symptom",
        eventValue: symptom,
        notes: payload.notes ?? ""
      });
    }

    return {
      stored: true,
      conversationId: this.conversationId,
      elderId: this.elderId
    };
  }

  private sendOpenAI(message: Record<string, unknown>) {
    if (this.openAi?.readyState === WebSocket.OPEN) {
      this.openAi.send(JSON.stringify(message));
    }
  }

  private sendTwilio(message: Record<string, unknown>) {
    if (this.telephonySocket.readyState === WebSocket.OPEN) {
      this.telephonySocket.send(JSON.stringify(message));
    }
  }
}
