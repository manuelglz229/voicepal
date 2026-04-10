import fs from "node:fs";
import Database from "better-sqlite3";
import { paths } from "./config.js";

fs.mkdirSync(paths.dataDir, { recursive: true });

export const db = new Database(paths.dbFile);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS elderly_users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    timezone TEXT NOT NULL,
    medication_plan TEXT NOT NULL,
    baseline_summary TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'low',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    elder_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    twilio_call_sid TEXT,
    stream_sid TEXT,
    realtime_session_id TEXT,
    summary TEXT NOT NULL DEFAULT '',
    mood TEXT NOT NULL DEFAULT 'unknown',
    compliance TEXT NOT NULL DEFAULT 'unknown',
    risk_level TEXT NOT NULL DEFAULT 'low',
    transcript TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    FOREIGN KEY (elder_id) REFERENCES elderly_users (id)
  );

  CREATE TABLE IF NOT EXISTS health_events (
    id TEXT PRIMARY KEY,
    elder_id TEXT NOT NULL,
    conversation_id TEXT,
    event_type TEXT NOT NULL,
    event_value TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (elder_id) REFERENCES elderly_users (id),
    FOREIGN KEY (conversation_id) REFERENCES conversations (id)
  );
`);

const count = db.prepare("SELECT COUNT(*) AS count FROM elderly_users").get() as { count: number };

if (count.count === 0) {
  const insert = db.prepare(`
    INSERT INTO elderly_users (
      id,
      full_name,
      phone_number,
      timezone,
      medication_plan,
      baseline_summary,
      risk_level
    ) VALUES (
      @id,
      @full_name,
      @phone_number,
      @timezone,
      @medication_plan,
      @baseline_summary,
      @risk_level
    )
  `);

  insert.run({
    id: "elder-maria-garcia",
    full_name: "Maria Garcia",
    phone_number: "+34123456789",
    timezone: "Europe/Madrid",
    medication_plan: "Lisinopril at 09:00, Metformin at 20:00, hydration reminder after lunch.",
    baseline_summary: "Lives alone, enjoys gardening, usually upbeat in the mornings, mild forgetfulness with evening medication.",
    risk_level: "medium"
  });

  insert.run({
    id: "elder-jose-martin",
    full_name: "Jose Martin",
    phone_number: "+34987654321",
    timezone: "Europe/Madrid",
    medication_plan: "Warfarin at 19:00, blood pressure check every Tuesday and Friday.",
    baseline_summary: "Prefers short calls, sometimes reports low energy, daughter Ana is emergency contact.",
    risk_level: "medium"
  });
}
