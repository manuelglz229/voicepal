import twilio from "twilio";
import { config, requireTelephonyConfig } from "../config.js";

export function createTwilioClient() {
  requireTelephonyConfig();
  return twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
}

export async function startOutboundCall(elderId: string, phoneNumber: string, conversationId: string) {
  const client = createTwilioClient();
  const voiceUrl = new URL("/twilio/voice/outbound", config.PUBLIC_BASE_URL);
  voiceUrl.searchParams.set("elderId", elderId);
  voiceUrl.searchParams.set("conversationId", conversationId);

  const statusUrl = new URL("/twilio/status", config.PUBLIC_BASE_URL);
  statusUrl.searchParams.set("conversationId", conversationId);

  return client.calls.create({
    to: phoneNumber,
    from: config.TWILIO_CALLER_NUMBER,
    url: voiceUrl.toString(),
    statusCallback: statusUrl.toString(),
    statusCallbackMethod: "POST",
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"]
  });
}

export function buildOutboundTwiML(streamUrl: string, elderId: string, conversationId: string) {
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({ url: streamUrl });
  stream.parameter({ name: "elderId", value: elderId });
  stream.parameter({ name: "conversationId", value: conversationId });
  return response.toString();
}
