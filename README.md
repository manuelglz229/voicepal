# Caregiver Voice Platform

A web-based caregiver platform with:

- outbound phone calls to elderly users through Twilio
- a low-latency server-side WebSocket bridge to OpenAI Realtime using `gpt-realtime-mini`
- conversation memory, medication compliance tracking, mood tracking, and caregiver notes
- a browser dashboard for caregivers

## Why this architecture

This project uses a server-side WebSocket bridge because that is the recommended pattern for server-to-server Realtime integrations, while Twilio bidirectional Media Streams expose raw call audio over WebSockets.

- OpenAI Realtime WebSocket guide: [developers.openai.com/api/docs/guides/realtime-websocket](https://developers.openai.com/api/docs/guides/realtime-websocket)
- OpenAI Realtime conversations guide: [developers.openai.com/api/docs/guides/realtime-conversations](https://developers.openai.com/api/docs/guides/realtime-conversations)
- Twilio Media Streams overview: [twilio.com/docs/voice/media-streams](https://www.twilio.com/docs/voice/media-streams)
- Twilio Media Streams WebSocket message format: [twilio.com/docs/voice/media-streams/websocket-messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages)

## Features

- Natural voice interactions with direct audio-to-audio Realtime sessions
- Low perceived latency by keeping the call path `Twilio <-> app server <-> OpenAI Realtime`
- Reliability-focused session recovery and persistent call logging
- Longitudinal memory so each call starts with relevant health context
- Structured extraction of:
  - mood
  - medication adherence
  - risk level
  - follow-up actions

## Project structure

```text
src/
  config.ts
  db.ts
  server.ts
  services/
    repository.ts
    telephony.ts
    voiceBridge.ts
  web/
    index.html
    app.js
    styles.css
```

## Quick start

1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Set a public HTTPS URL in `PUBLIC_BASE_URL`.
4. Install dependencies:

```bash
npm install
```

5. Run the app:

```bash
npm run dev
```

6. Open `http://localhost:3000`.

## Twilio setup

The server creates outbound calls with the Twilio REST API and returns TwiML that attaches the live call to a bidirectional Media Stream:

- `POST /api/elders/:id/call` initiates the outbound phone call
- `POST /twilio/voice/outbound` returns `<Connect><Stream>` TwiML
- `GET /ws/twilio-media` bridges Twilio audio to OpenAI Realtime

Set your public domain so Twilio can reach:

- `https://your-domain/twilio/voice/outbound`
- `wss://your-domain/ws/twilio-media`

## Reliability and latency notes

- `g711_ulaw` is used end-to-end to avoid unnecessary transcoding between Twilio and the Realtime model.
- Server VAD is enabled so the model can respond quickly after speech stops.
- On caller interruption, the bridge cancels the active response, clears Twilio playback, and truncates the assistant turn to keep context aligned.
- Structured memory is injected into the system prompt at call start so the agent learns from prior conversations without needing external retrieval infrastructure.

## Current limitations

- This is an MVP scaffold, not a production HIPAA deployment.
- You should add:
  - authenticated caregiver accounts
  - audit logs
  - encrypted PHI storage
  - signed Twilio request validation
  - a job queue for scheduled calls and retries
  - escalation workflows to nurses or family members

## Seed data

On first boot the app seeds two demo users into `data/caregiver.db`.
