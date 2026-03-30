import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

function callable(name) {
  return httpsCallable(functions, name);
}

async function invoke(name, payload) {
  const fn = callable(name);
  const result = await fn(payload);
  return result?.data || {};
}

export function toAdminMessage(error, fallback) {
  const message =
    error?.details?.message ||
    error?.message ||
    fallback;

  if (typeof message !== "string") {
    return fallback;
  }

  return message.replace(/^functions\//, "").trim() || fallback;
}

export function verifyAdminAccess(password) {
  return invoke("adminVerifyAccess", { password });
}

export function fetchAdminOverview(password) {
  return invoke("adminGetOverview", { password });
}

export function fetchAdminRuntimeConfig(password) {
  return invoke("adminGetRuntimeConfig", { password });
}

export function updateAdminRuntimeConfig(password, config, reason) {
  return invoke("adminUpdateRuntimeConfig", { password, config, reason });
}

export function searchAdminEntities(password, entityType, query, options = {}) {
  return invoke("adminSearchEntities", {
    password,
    entityType,
    query,
    limit: options.limit,
    includeArchived: options.includeArchived,
  });
}

export function updateAdminEntity(password, entityType, entityId, updates, reason) {
  return invoke("adminUpdateEntity", {
    password,
    entityType,
    entityId,
    updates,
    reason,
  });
}

export function archiveAdminEntity(password, entityType, entityId, archived, reason) {
  return invoke("adminArchiveEntity", {
    password,
    entityType,
    entityId,
    archived,
    reason,
  });
}

export function fetchAdminAuditLog(password, limit = 20) {
  return invoke("adminListAuditLog", { password, limit });
}
