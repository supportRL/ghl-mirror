const BASE_URL = "https://services.leadconnectorhq.com";

function apiErrorMessage(data, fallback) {
  if (!data) return fallback;
  if (typeof data.message === "string" && data.message) return data.message;
  if (Array.isArray(data.message) && data.message.length) {
    return data.message.map(String).join(", ");
  }
  if (typeof data.error === "string" && data.error) return data.error;
  return fallback;
}

export async function ghlRequest(token, path, { method = "GET", body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(
      apiErrorMessage(data, `GoHighLevel request failed (${response.status})`),
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function findContactByEmail(token, locationId, email) {
  const params = new URLSearchParams({ locationId, email });
  const data = await ghlRequest(token, `/contacts/search/duplicate?${params.toString()}`);
  if (!data?.contact?.id) return null;
  return data.contact;
}

export async function getContactCustomFields(token, locationId) {
  const data = await ghlRequest(
    token,
    `/locations/${encodeURIComponent(locationId)}/customFields?model=contact`,
  );
  return data?.customFields ?? [];
}

export async function createContact(token, payload) {
  const data = await ghlRequest(token, "/contacts/", {
    method: "POST",
    body: payload,
  });
  return data?.contact ?? data;
}
