import dotenv from "dotenv";
import path from "node:path";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-realtime-mini"),
  OPENAI_REALTIME_VOICE: z.string().default("sage"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_CALLER_NUMBER: z.string().default("")
});

export const config = envSchema.parse(process.env);

export const paths = {
  projectRoot: process.cwd(),
  dataDir: path.join(process.cwd(), "data"),
  webDir: path.join(process.cwd(), "src", "web"),
  dbFile: path.join(process.cwd(), "data", "caregiver.db")
};

export function requireTelephonyConfig() {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.TWILIO_CALLER_NUMBER) {
    throw new Error("Twilio credentials are missing. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_CALLER_NUMBER.");
  }
}

export function requireOpenAIConfig() {
  if (!config.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing.");
  }
}
