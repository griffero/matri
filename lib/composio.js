const COMPOSIO_API_KEY = process.env.COMPOSIO_API_KEY || "";
const COMPOSIO_ENTITY_ID = process.env.COMPOSIO_ENTITY_ID || "default";
const COMPOSIO_BASE = "https://backend.composio.dev/api/v3";

async function executeAction(actionName, args) {
  if (!COMPOSIO_API_KEY) {
    throw new Error("COMPOSIO_API_KEY no configurada");
  }

  const url = `${COMPOSIO_BASE}/tools/execute/${encodeURIComponent(actionName)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-API-Key": COMPOSIO_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      user_id: COMPOSIO_ENTITY_ID,
      arguments: args
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Composio ${res.status}: ${text}`);
  }

  return res.json();
}

module.exports = { executeAction };
