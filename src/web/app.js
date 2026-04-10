const elderList = document.querySelector("#elder-list");
const metrics = document.querySelector("#metrics");
const conversationList = document.querySelector("#conversation-list");
const refreshButton = document.querySelector("#refresh");
const elderTemplate = document.querySelector("#elder-template");

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

function renderMetrics(data) {
  metrics.innerHTML = `
    <div class="metric-card">
      <span>Total elderly users</span>
      <strong>${data.totalElders}</strong>
    </div>
    <div class="metric-card">
      <span>Active calls</span>
      <strong>${data.activeCalls}</strong>
    </div>
    <div class="metric-card">
      <span>High-risk users</span>
      <strong>${data.highRisk}</strong>
    </div>
  `;
}

function latestInsightFor(elder) {
  const lastCall = elder.memory?.lastCalls?.[0];
  if (!lastCall) {
    return "No previous conversation yet. The first call will establish baseline mood and adherence.";
  }

  const summary = lastCall.summary || "Conversation logged without a final summary yet.";
  return `${lastCall.started_at}: ${summary}`;
}

function riskClass(risk) {
  return `risk-${String(risk || "low").toLowerCase()}`;
}

function renderElders(elders) {
  elderList.innerHTML = "";

  elders.forEach((elder) => {
    const node = elderTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("h3").textContent = elder.full_name;
    node.querySelector(".phone").textContent = `${elder.phone_number} | ${elder.timezone}`;
    node.querySelector(".baseline").textContent = elder.baseline_summary;
    node.querySelector(".medication").textContent = elder.medication_plan;
    node.querySelector(".insight").textContent = latestInsightFor(elder);

    const pill = node.querySelector(".risk-pill");
    pill.textContent = elder.risk_level;
    pill.classList.add(riskClass(elder.risk_level));

    node.querySelector(".call-btn").addEventListener("click", async () => {
      const button = node.querySelector(".call-btn");
      button.disabled = true;
      button.textContent = "Dialing...";

      try {
        const result = await fetchJson(`/api/elders/${elder.id}/call`, {
          method: "POST"
        });
        button.textContent = `Call queued (${result.callSid})`;
      } catch (error) {
        button.disabled = false;
        button.textContent = "Start Check-in Call";
        window.alert(error.message);
      }
    });

    elderList.appendChild(node);
  });
}

function renderConversations(conversations) {
  if (!conversations.length) {
    conversationList.innerHTML = `<p class="empty-state">No conversations yet.</p>`;
    return;
  }

  conversationList.innerHTML = conversations
    .map((conversation) => {
      const metadata = (() => {
        try {
          return JSON.parse(conversation.metadata_json || "{}");
        } catch {
          return {};
        }
      })();

      return `
        <article class="conversation-item">
          <div class="conversation-topline">
            <strong>${conversation.elder_id}</strong>
            <span class="status-badge ${riskClass(conversation.risk_level)}">${conversation.status}</span>
          </div>
          <p>${conversation.summary || "Summary pending."}</p>
          <div class="conversation-meta">
            <span>Mood: ${conversation.mood}</span>
            <span>Compliance: ${conversation.compliance}</span>
            <span>Risk: ${conversation.risk_level}</span>
            <span>Follow-up: ${metadata.followUpNeeded ? "yes" : "no"}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

async function refresh() {
  const [dashboard, elders, conversations] = await Promise.all([
    fetchJson("/api/dashboard"),
    fetchJson("/api/elders"),
    fetchJson("/api/conversations")
  ]);

  renderMetrics(dashboard);
  renderElders(elders);
  renderConversations(conversations);
}

refreshButton.addEventListener("click", refresh);
refresh().catch((error) => {
  metrics.innerHTML = `<p class="empty-state">${error.message}</p>`;
});
