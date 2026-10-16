import "./env.js";
import { createContact, findContactByEmail, getContactCustomFields } from "./ghl.js";

const STANDARD_FIELDS = [
  "firstName",
  "lastName",
  "name",
  "email",
  "phone",
  "address1",
  "city",
  "state",
  "postalCode",
  "website",
  "timezone",
  "companyName",
  "source",
  "country",
  "gender",
  "dateOfBirth",
];

const SKIPPED_FIELD_TYPES = new Set(["FILE_UPLOAD", "SIGNATURE"]);

const TEAM_ASSIGNEES = {
  "team 1": "Q0aVHyBbFhqJxWuEKLMt",
  "team 2": "uqAeFfwbHnH0lCwSvprz",
  "team 3": "YNlj27LBFv74CKLrh1zy",
};

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

const enrollment = {
  token: requiredEnv("GHL_TOKEN_ENROLLMENT"),
  locationId: requiredEnv("GHL_LOCATION_ID_ENROLLMENT"),
};

const clients = {
  token: requiredEnv("GHL_TOKEN_CLIENTS"),
  locationId: requiredEnv("GHL_LOCATION_ID_CLIENTS"),
};

let fieldMapCache = null;
let fieldMapLoadedAt = 0;
const FIELD_MAP_TTL_MS = 5 * 60 * 1000;

function fieldKey(field) {
  return String(field.fieldKey || "").replace(/^contact\./, "");
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function assigneeForTeam(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return TEAM_ASSIGNEES[normalized] || null;
}

export async function loadFieldMaps() {
  const [enrollmentFields, clientFields] = await Promise.all([
    getContactCustomFields(enrollment.token, enrollment.locationId),
    getContactCustomFields(clients.token, clients.locationId),
  ]);

  const enrollmentById = new Map(enrollmentFields.map((field) => [field.id, field]));
  const clientsByKey = new Map(clientFields.map((field) => [fieldKey(field), field]));

  let shared = 0;
  for (const field of enrollmentFields) {
    if (clientsByKey.has(fieldKey(field))) shared += 1;
  }

  return {
    enrollmentById,
    clientsByKey,
    enrollmentCount: enrollmentFields.length,
    clientsCount: clientFields.length,
    shared,
  };
}

async function getFieldMaps() {
  if (fieldMapCache && Date.now() - fieldMapLoadedAt < FIELD_MAP_TTL_MS) {
    return fieldMapCache;
  }
  fieldMapCache = await loadFieldMaps();
  fieldMapLoadedAt = Date.now();
  return fieldMapCache;
}

export async function warmFieldMaps() {
  const maps = await getFieldMaps();
  return {
    enrollment: maps.enrollmentCount,
    clients: maps.clientsCount,
    shared: maps.shared,
  };
}

export function buildClientPayload(contact, maps) {
  const payload = { locationId: clients.locationId };
  const skippedCustomFields = [];

  for (const key of STANDARD_FIELDS) {
    if (hasValue(contact[key])) payload[key] = contact[key];
  }

  if (!payload.name) {
    const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
    if (name) payload.name = name;
  }

  if (Array.isArray(contact.tags) && contact.tags.length) payload.tags = contact.tags;
  if (typeof contact.dnd === "boolean") payload.dnd = contact.dnd;
  if (contact.dndSettings && Object.keys(contact.dndSettings).length) {
    payload.dndSettings = contact.dndSettings;
  }
  if (contact.inboundDndSettings && Object.keys(contact.inboundDndSettings).length) {
    payload.inboundDndSettings = contact.inboundDndSettings;
  }

  const customFields = [];
  let team = null;
  for (const entry of contact.customFields || []) {
    if (!hasValue(entry.value)) continue;

    const sourceField = maps.enrollmentById.get(entry.id);
    if (!sourceField) {
      skippedCustomFields.push(entry.id);
      continue;
    }

    const key = fieldKey(sourceField);
    if (key === "teams") team = entry.value;

    if (SKIPPED_FIELD_TYPES.has(sourceField.dataType)) {
      skippedCustomFields.push(key);
      continue;
    }

    const targetField = maps.clientsByKey.get(key);
    if (!targetField) {
      skippedCustomFields.push(key);
      continue;
    }

    customFields.push({
      id: targetField.id,
      key,
      fieldValue: entry.value,
    });
  }

  const assignedTo = assigneeForTeam(team);
  if (assignedTo) payload.assignedTo = assignedTo;

  if (customFields.length) payload.customFields = customFields;
  return { payload, skippedCustomFields, team };
}

export async function mirrorContact(email) {
  const source = await findContactByEmail(enrollment.token, enrollment.locationId, email);
  if (!source) {
    return { statusCode: 404, body: { message: "not found" } };
  }

  const existing = await findContactByEmail(clients.token, clients.locationId, email);
  if (existing) {
    return {
      statusCode: 200,
      body: { message: "Contact already exists", contactId: existing.id },
    };
  }

  const maps = await getFieldMaps();
  const { payload, skippedCustomFields, team } = buildClientPayload(source, maps);
  const created = await createContact(clients.token, payload);

  const body = {
    message: "Contact created",
    contactId: created?.id ?? null,
  };
  if (team) body.team = team;
  if (payload.assignedTo) body.assignedTo = payload.assignedTo;
  if (skippedCustomFields.length) body.skippedCustomFields = skippedCustomFields;

  return { statusCode: 201, body };
}
