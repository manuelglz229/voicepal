import crypto from "node:crypto";
import { db } from "../db.js";

export type Elder = {
  id: string;
  full_name: string;
  phone_number: string;
  timezone: string;
  medication_plan: string;
  baseline_summary: string;
  risk_level: string;
  created_at: string;
};

export type Conversation = {
  id: string;
  elder_id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  twilio_call_sid: string | null;
  stream_sid: string | null;
  realtime_session_id: string | null;
  summary: string;
  mood: string;
  compliance: string;
  risk_level: string;
  transcript: string;
  metadata_json: string;
};

type HealthEventInput = {
  elderId: string;
  conversationId?: string;
  eventType: string;
  eventValue: string;
  notes?: string;
};

export const repository = {
  listElders(): Elder[] {
    return db.prepare("SELECT * FROM elderly_users ORDER BY full_name").all() as Elder[];
  },

  getElder(id: string): Elder | undefined {
    return db.prepare("SELECT * FROM elderly_users WHERE id = ?").get(id) as Elder | undefined;
  },

  createElder(input: Omit<Elder, "created_at">) {
    db.prepare(`
      INSERT INTO elderly_users (
        id,
        full_name,
        phone_number,
        timezone,
        medication_plan,
        baseline_summary,
        risk_level
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.full_name,
      input.phone_number,
      input.timezone,
      input.medication_plan,
      input.baseline_summary,
      input.risk_level
    );

    return this.getElder(input.id);
  },

  updateElderRisk(id: string, riskLevel: string) {
    db.prepare(`
      UPDATE elderly_users
      SET risk_level = ?
      WHERE id = ?
    `).run(riskLevel, id);

    return this.getElder(id);
  },

  createConversation(elderId: string) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO conversations (
        id,
        elder_id,
        started_at,
        status
      ) VALUES (?, ?, CURRENT_TIMESTAMP, 'initiated')
    `).run(id, elderId);

    return this.getConversation(id);
  },

  getConversation(id: string) {
    return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
  },

  listRecentConversations(limit = 20): Conversation[] {
    return db.prepare(`
      SELECT * FROM conversations
      ORDER BY datetime(started_at) DESC
      LIMIT ?
    `).all(limit) as Conversation[];
  },

  updateConversation(id: string, patch: Partial<Conversation>) {
    const current = this.getConversation(id);
    if (!current) {
      return undefined;
    }

    const next = { ...current, ...patch };
    db.prepare(`
      UPDATE conversations
      SET
        elder_id = @elder_id,
        started_at = @started_at,
        ended_at = @ended_at,
        status = @status,
        twilio_call_sid = @twilio_call_sid,
        stream_sid = @stream_sid,
        realtime_session_id = @realtime_session_id,
        summary = @summary,
        mood = @mood,
        compliance = @compliance,
        risk_level = @risk_level,
        transcript = @transcript,
        metadata_json = @metadata_json
      WHERE id = @id
    `).run(next);

    return this.getConversation(id);
  },

  addHealthEvent(input: HealthEventInput) {
    db.prepare(`
      INSERT INTO health_events (
        id,
        elder_id,
        conversation_id,
        event_type,
        event_value,
        notes
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      input.elderId,
      input.conversationId ?? null,
      input.eventType,
      input.eventValue,
      input.notes ?? ""
    );
  },

  getHealthTimeline(elderId: string) {
    return db.prepare(`
      SELECT event_type, event_value, notes, created_at
      FROM health_events
      WHERE elder_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT 20
    `).all(elderId) as Array<{
      event_type: string;
      event_value: string;
      notes: string;
      created_at: string;
    }>;
  },

  buildMemorySnapshot(elderId: string) {
    const elder = this.getElder(elderId);
    if (!elder) {
      return null;
    }

    const lastCalls = db.prepare(`
      SELECT started_at, summary, mood, compliance, risk_level
      FROM conversations
      WHERE elder_id = ?
      ORDER BY datetime(started_at) DESC
      LIMIT 5
    `).all(elderId) as Array<{
      started_at: string;
      summary: string;
      mood: string;
      compliance: string;
      risk_level: string;
    }>;

    const events = this.getHealthTimeline(elderId);

    return {
      elder,
      lastCalls,
      events
    };
  }
};
