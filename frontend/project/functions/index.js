const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10,
});

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const RESERVATION_TTL_MS = 30 * 60 * 1000;
const ACTIVE_TRANSPORT_STATUSES = ["accepted", "paused"];
const ADMIN_PANEL_PASSWORD = defineSecret("ADMIN_PANEL_PASSWORD");
const USER_ROLES = new Set(["buyer", "farmer", "transporter"]);
const TRANSPORT_REQUEST_STATUSES = new Set([
  "open",
  "accepted",
  "paused",
  "completed",
  "cancelled",
]);
const TRANSPORT_DELIVERY_STAGES = new Set([
  "queued",
  "accepted",
  "paused",
  "resumed",
  "picked_up",
  "completed",
  "cancelled",
]);
const STOCK_TRANSPORT_STATUSES = new Set([
  "available",
  "reserved",
  "awaiting_transporter",
  "in_delivery",
  "delivered",
]);
const ADMIN_ENTITY_TYPES = new Set([
  "users",
  "stocks",
  "orders",
  "transport_requests",
]);
const ADMIN_SEARCH_LIMIT = 40;
const PUBLIC_CONFIG_REF = db.collection("app_config").doc("public");
const DELIVERY_STATUS_INPUTS = new Set([
  "accepted",
  "paused",
  "resumed",
  "picked_up",
  "completed",
  "cancelled",
]);

const ORDER_STATUS = {
  REQUESTED: "requested",
  FARMER_ACCEPTED: "farmer_accepted",
  FARMER_REJECTED: "farmer_rejected",
  AWAITING_TRANSPORTER: "awaiting_transporter",
  IN_DELIVERY: "in_delivery",
  DELIVERED: "delivered",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
};
const DEFAULT_PUBLIC_CONFIG = Object.freeze({
  features: {
    aiChatEnabled: true,
    orderThreadsEnabled: true,
    predictionsEnabled: true,
    signupEnabled: true,
    contactFormEnabled: true,
  },
  site: {
    maintenanceEnabled: false,
    maintenanceTitle: "Farm2Market is under maintenance",
    maintenanceMessage:
      "We are making updates right now. Please check back soon.",
  },
});

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be logged in.");
  }
  return request.auth.uid;
}

function asPositiveNumber(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be a positive number.`
    );
  }
  return n;
}

function asNonNegativeNumber(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpsError(
      "invalid-argument",
      `${fieldName} must be zero or greater.`
    );
  }
  return n;
}

function asNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `${fieldName} is required.`);
  }
  return value.trim();
}

function asBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", `${fieldName} must be true or false.`);
  }
  return value;
}

function asNullableString(value, fieldName, maxLength = 300) {
  if (value == null) return null;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeLimit(value, fallback = ADMIN_SEARCH_LIMIT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(numeric)));
}

function normalizeTextSearch(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function getUserProfile(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "User profile not found.");
  }

  const data = snap.data() || {};
  if (!data.role) {
    throw new HttpsError("failed-precondition", "User role is missing.");
  }

  return {
    ...data,
    uid,
    isAdmin: data.isAdmin === true,
    accountStatus: data.accountStatus === "disabled" ? "disabled" : "active",
  };
}

function ensureAccountEnabled(profile) {
  if (profile?.accountStatus === "disabled") {
    throw new HttpsError("permission-denied", "This account is disabled.");
  }
}

async function assertRole(uid, expectedRole) {
  const profile = await getUserProfile(uid);
  ensureAccountEnabled(profile);
  if (profile.role !== expectedRole) {
    throw new HttpsError("permission-denied", `Only ${expectedRole}s can do this.`);
  }
  return profile;
}

function getStockBuckets(stock) {
  const total = Number(stock?.quantity || 0);

  const hasAvailable = Number.isFinite(Number(stock?.availableQtyKg));
  const hasReserved = Number.isFinite(Number(stock?.reservedQtyKg));

  const available = hasAvailable ? Number(stock.availableQtyKg) : Math.max(0, total);
  const reserved = hasReserved
    ? Number(stock.reservedQtyKg)
    : Math.max(0, total - available);

  return {
    total,
    available: Math.max(0, available),
    reserved: Math.max(0, reserved),
  };
}

function appendTimeline(existing, entries) {
  const base = Array.isArray(existing) ? existing : [];
  return [...base, ...entries];
}

function queueNotification(tx, payload, now) {
  const ref = db.collection("notifications").doc();
  tx.set(ref, {
    recipientId: payload.recipientId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    entityType: payload.entityType || null,
    entityId: payload.entityId || null,
    actionUrl: payload.actionUrl || null,
    readAt: null,
    createdAt: now,
  });
}

function deriveDisplayName(profile, fallback = "User") {
  const fullName = `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim();
  return fullName || profile?.displayName || profile?.email || fallback;
}

function mergePublicConfig(rawConfig) {
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const features = raw.features && typeof raw.features === "object" ? raw.features : {};
  const site = raw.site && typeof raw.site === "object" ? raw.site : {};

  return {
    features: {
      aiChatEnabled:
        typeof features.aiChatEnabled === "boolean"
          ? features.aiChatEnabled
          : DEFAULT_PUBLIC_CONFIG.features.aiChatEnabled,
      orderThreadsEnabled:
        typeof features.orderThreadsEnabled === "boolean"
          ? features.orderThreadsEnabled
          : DEFAULT_PUBLIC_CONFIG.features.orderThreadsEnabled,
      predictionsEnabled:
        typeof features.predictionsEnabled === "boolean"
          ? features.predictionsEnabled
          : DEFAULT_PUBLIC_CONFIG.features.predictionsEnabled,
      signupEnabled:
        typeof features.signupEnabled === "boolean"
          ? features.signupEnabled
          : DEFAULT_PUBLIC_CONFIG.features.signupEnabled,
      contactFormEnabled:
        typeof features.contactFormEnabled === "boolean"
          ? features.contactFormEnabled
          : DEFAULT_PUBLIC_CONFIG.features.contactFormEnabled,
    },
    site: {
      maintenanceEnabled:
        typeof site.maintenanceEnabled === "boolean"
          ? site.maintenanceEnabled
          : DEFAULT_PUBLIC_CONFIG.site.maintenanceEnabled,
      maintenanceTitle:
        typeof site.maintenanceTitle === "string" && site.maintenanceTitle.trim()
          ? site.maintenanceTitle.trim().slice(0, 120)
          : DEFAULT_PUBLIC_CONFIG.site.maintenanceTitle,
      maintenanceMessage:
        typeof site.maintenanceMessage === "string" && site.maintenanceMessage.trim()
          ? site.maintenanceMessage.trim().slice(0, 400)
          : DEFAULT_PUBLIC_CONFIG.site.maintenanceMessage,
    },
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

async function getPublicRuntimeConfig() {
  const snap = await PUBLIC_CONFIG_REF.get();
  return mergePublicConfig(snap.exists ? snap.data() : null);
}

async function assertRuntimeAccess(
  profile,
  {
    blockDuringMaintenance = true,
    requireOrderThreads = false,
    requireSignup = false,
    requireContactForm = false,
  } = {}
) {
  const config = await getPublicRuntimeConfig();

  if (blockDuringMaintenance && config.site.maintenanceEnabled && !profile?.isAdmin) {
    throw new HttpsError(
      "failed-precondition",
      "Farm2Market is temporarily unavailable during maintenance."
    );
  }

  if (requireOrderThreads && !config.features.orderThreadsEnabled) {
    throw new HttpsError("failed-precondition", "Order threads are currently disabled.");
  }

  if (requireSignup && !config.features.signupEnabled) {
    throw new HttpsError("failed-precondition", "Signup is currently disabled.");
  }

  if (requireContactForm && !config.features.contactFormEnabled) {
    throw new HttpsError("failed-precondition", "Contact messages are currently disabled.");
  }

  return config;
}

function assertNotArchived(record, label) {
  if (record?.archivedAt) {
    throw new HttpsError("failed-precondition", `${label} is archived.`);
  }
}

function serializeValue(value) {
  if (value == null) return value;

  if (value instanceof admin.firestore.Timestamp) {
    return value.toDate().toISOString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeValue(entry));
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeValue(entry)])
    );
  }

  return value;
}

function pickFields(data, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = serializeValue(data?.[key] ?? null);
    return acc;
  }, {});
}

function summarizeEntity(entityType, entityId, data) {
  const raw = data || {};

  if (entityType === "users") {
    return {
      id: entityId,
      entityType,
      ...pickFields(raw, [
        "firstName",
        "lastName",
        "email",
        "phone",
        "role",
        "isAdmin",
        "accountStatus",
        "createdAt",
        "lastSeenAt",
      ]),
    };
  }

  if (entityType === "stocks") {
    return {
      id: entityId,
      entityType,
      ...pickFields(raw, [
        "vegetable",
        "market",
        "pickupLocation",
        "quality",
        "quantity",
        "availableQtyKg",
        "reservedQtyKg",
        "price",
        "phone",
        "transportStatus",
        "farmerId",
        "createdAt",
        "updatedAt",
        "archivedAt",
      ]),
    };
  }

  if (entityType === "orders") {
    return {
      id: entityId,
      entityType,
      ...pickFields(raw, [
        "stockId",
        "buyerId",
        "farmerId",
        "transporterId",
        "requestedQtyKg",
        "pricePerKg",
        "market",
        "status",
        "transportRequestId",
        "reservationExpiresAt",
        "createdAt",
        "updatedAt",
        "archivedAt",
      ]),
    };
  }

  return {
    id: entityId,
    entityType,
    ...pickFields(raw, [
      "orderId",
      "stockId",
      "buyerId",
      "farmerId",
      "transporterId",
      "requestedQtyKg",
      "status",
      "deliveryStage",
      "vegetable",
      "market",
      "pickupLocation",
      "phone",
      "createdAt",
      "updatedAt",
      "archivedAt",
    ]),
  };
}

async function writeAdminAuditLog({
  actorId,
  action,
  entityType,
  entityId,
  reason = null,
  before = null,
  after = null,
}) {
  await db.collection("admin_audit_log").add({
    actorId,
    action,
    entityType,
    entityId,
    reason: reason || null,
    before: before || null,
    after: after || null,
    createdAt: Timestamp.now(),
  });
}

function getEntityRef(entityType, entityId) {
  if (!ADMIN_ENTITY_TYPES.has(entityType)) {
    throw new HttpsError("invalid-argument", "Unsupported admin entity type.");
  }

  return db.collection(entityType).doc(entityId);
}

function getSearchOrderField(entityType) {
  if (entityType === "users") return "createdAt";
  return "createdAt";
}

async function fetchSearchDocs(entityType, limitCount) {
  const collectionRef = db.collection(entityType);
  const orderField = getSearchOrderField(entityType);

  try {
    const snap = await collectionRef.orderBy(orderField, "desc").limit(limitCount).get();
    return snap.docs;
  } catch (error) {
    const fallback = await collectionRef.limit(limitCount).get();
    return fallback.docs;
  }
}

function matchesAdminSearch(item, searchTerm) {
  if (!searchTerm) return true;

  const haystack = JSON.stringify(item).toLowerCase();
  return haystack.includes(searchTerm);
}

function mapOrderStatusToTransportStatus(status, currentTransportStatus) {
  if (status === ORDER_STATUS.AWAITING_TRANSPORTER) return "open";
  if (status === ORDER_STATUS.IN_DELIVERY) {
    return currentTransportStatus === "paused" ? "paused" : "accepted";
  }
  if (status === ORDER_STATUS.DELIVERED) return "completed";
  if (status === ORDER_STATUS.CANCELLED) return "cancelled";
  return null;
}

function mapTransportStatusToOrderStatus(status) {
  if (status === "open") return ORDER_STATUS.AWAITING_TRANSPORTER;
  if (status === "accepted" || status === "paused") return ORDER_STATUS.IN_DELIVERY;
  if (status === "completed") return ORDER_STATUS.DELIVERED;
  if (status === "cancelled") return ORDER_STATUS.CANCELLED;
  return null;
}

function resolveAdminPassword(request) {
  const candidate = asNonEmptyString(request.data?.password, "password");
  const expected = ADMIN_PANEL_PASSWORD.value();

  if (!expected) {
    throw new HttpsError(
      "failed-precondition",
      "Admin password secret is not configured."
    );
  }

  if (candidate !== expected) {
    throw new HttpsError("permission-denied", "Incorrect admin password.");
  }
}

async function assertAdminAccess(request, { requirePassword = true } = {}) {
  const uid = requireAuth(request);
  const profile = await getUserProfile(uid);
  ensureAccountEnabled(profile);

  if (!profile.isAdmin) {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }

  if (requirePassword) {
    resolveAdminPassword(request);
  }

  return profile;
}

function buildUserUpdates(before, updates) {
  const next = {};
  let authDisabled = null;

  if ("firstName" in updates) {
    next.firstName = asNonEmptyString(updates.firstName, "firstName").slice(0, 80);
  }

  if ("lastName" in updates) {
    next.lastName = asNonEmptyString(updates.lastName, "lastName").slice(0, 80);
  }

  if ("phone" in updates) {
    next.phone = asNullableString(updates.phone, "phone", 30) || "";
  }

  if ("role" in updates) {
    const role = asNonEmptyString(updates.role, "role").toLowerCase();
    if (!USER_ROLES.has(role)) {
      throw new HttpsError("invalid-argument", "Unsupported user role.");
    }
    next.role = role;
  }

  if ("isAdmin" in updates) {
    next.isAdmin = asBoolean(updates.isAdmin, "isAdmin");
  }

  if ("accountStatus" in updates) {
    const status = asNonEmptyString(updates.accountStatus, "accountStatus").toLowerCase();
    if (status !== "active" && status !== "disabled") {
      throw new HttpsError("invalid-argument", "accountStatus must be active or disabled.");
    }
    next.accountStatus = status;
    authDisabled = status === "disabled";
  }

  if (Object.keys(next).length === 0) {
    throw new HttpsError("invalid-argument", "No user updates were provided.");
  }

  next.updatedAt = Timestamp.now();

  return {
    firestoreUpdates: next,
    authDisabled,
  };
}

function buildStockUpdates(before, updates) {
  const next = {};
  const shouldRebalance =
    "quantity" in updates ||
    "availableQtyKg" in updates ||
    "reservedQtyKg" in updates;

  if ("vegetable" in updates) {
    next.vegetable = asNonEmptyString(updates.vegetable, "vegetable").slice(0, 120);
  }

  if ("market" in updates) {
    next.market = asNonEmptyString(updates.market, "market").slice(0, 120);
  }

  if ("pickupLocation" in updates) {
    next.pickupLocation =
      asNullableString(updates.pickupLocation, "pickupLocation", 160) || null;
  }

  if ("quality" in updates) {
    next.quality = asNullableString(updates.quality, "quality", 40) || null;
  }

  if ("phone" in updates) {
    next.phone = asNullableString(updates.phone, "phone", 30) || "";
  }

  if ("price" in updates) {
    next.price = asNonNegativeNumber(updates.price, "price");
  }

  if ("photoUrl" in updates) {
    next.photoUrl = asNullableString(updates.photoUrl, "photoUrl", 500) || null;
  }

  if ("transportStatus" in updates) {
    const transportStatus = asNonEmptyString(
      updates.transportStatus,
      "transportStatus"
    ).toLowerCase();
    if (!STOCK_TRANSPORT_STATUSES.has(transportStatus)) {
      throw new HttpsError("invalid-argument", "Unsupported stock transport status.");
    }
    next.transportStatus = transportStatus;
  }

  if (shouldRebalance) {
    const quantity = "quantity" in updates
      ? asNonNegativeNumber(updates.quantity, "quantity")
      : asNonNegativeNumber(before.quantity || 0, "quantity");
    const availableQtyKg = "availableQtyKg" in updates
      ? asNonNegativeNumber(updates.availableQtyKg, "availableQtyKg")
      : asNonNegativeNumber(before.availableQtyKg ?? before.quantity ?? 0, "availableQtyKg");
    const reservedQtyKg = "reservedQtyKg" in updates
      ? asNonNegativeNumber(updates.reservedQtyKg, "reservedQtyKg")
      : asNonNegativeNumber(before.reservedQtyKg ?? 0, "reservedQtyKg");

    if (availableQtyKg + reservedQtyKg > quantity) {
      throw new HttpsError(
        "invalid-argument",
        "availableQtyKg plus reservedQtyKg cannot exceed quantity."
      );
    }

    next.quantity = quantity;
    next.availableQtyKg = availableQtyKg;
    next.reservedQtyKg = reservedQtyKg;
  }

  if (Object.keys(next).length === 0) {
    throw new HttpsError("invalid-argument", "No stock updates were provided.");
  }

  next.updatedAt = Timestamp.now();
  return { firestoreUpdates: next };
}

function buildOrderUpdates(before, updates, actorId) {
  const next = {};
  const linkedTransportUpdates = {};
  const now = Timestamp.now();

  if ("requestedQtyKg" in updates) {
    next.requestedQtyKg = asPositiveNumber(updates.requestedQtyKg, "requestedQtyKg");
  }

  if ("pricePerKg" in updates) {
    next.pricePerKg = asNonNegativeNumber(updates.pricePerKg, "pricePerKg");
  }

  if ("market" in updates) {
    next.market = asNullableString(updates.market, "market", 120) || null;
  }

  if ("transporterId" in updates) {
    next.transporterId = asNullableString(updates.transporterId, "transporterId", 128);
    if (before.transportRequestId) {
      linkedTransportUpdates.transporterId = next.transporterId;
    }
  }

  if ("status" in updates) {
    const status = asNonEmptyString(updates.status, "status").toLowerCase();
    if (!Object.values(ORDER_STATUS).includes(status)) {
      throw new HttpsError("invalid-argument", "Unsupported order status.");
    }

    next.status = status;
    next.statusTimeline = appendTimeline(before.statusTimeline, [
      {
        status,
        byUserId: actorId,
        at: now,
        adminOverride: true,
      },
    ]);

    const linkedTransportStatus = mapOrderStatusToTransportStatus(
      status,
      before.transportStatus || null
    );
    if (before.transportRequestId && linkedTransportStatus) {
      linkedTransportUpdates.status = linkedTransportStatus;
    }
  }

  if (Object.keys(next).length === 0) {
    throw new HttpsError("invalid-argument", "No order updates were provided.");
  }

  next.updatedAt = now;

  return {
    firestoreUpdates: next,
    linkedTransportUpdates,
  };
}

function buildTransportUpdates(before, updates, actorId) {
  const next = {};
  const linkedOrderUpdates = {};
  const now = Timestamp.now();

  if ("requestedQtyKg" in updates) {
    next.requestedQtyKg = asPositiveNumber(updates.requestedQtyKg, "requestedQtyKg");
  }

  if ("transporterId" in updates) {
    next.transporterId = asNullableString(updates.transporterId, "transporterId", 128);
    if (before.orderId) {
      linkedOrderUpdates.transporterId = next.transporterId;
    }
  }

  if ("status" in updates) {
    const status = asNonEmptyString(updates.status, "status").toLowerCase();
    if (!TRANSPORT_REQUEST_STATUSES.has(status)) {
      throw new HttpsError(
        "invalid-argument",
        "Unsupported transport request status."
      );
    }
    next.status = status;

    const orderStatus = mapTransportStatusToOrderStatus(status);
    if (before.orderId && orderStatus) {
      linkedOrderUpdates.status = orderStatus;
      linkedOrderUpdates.adminStatusEntry = {
        status: orderStatus,
        byUserId: actorId,
        at: now,
        adminOverride: true,
      };
    }
  }

  if ("deliveryStage" in updates) {
    const stage = asNonEmptyString(updates.deliveryStage, "deliveryStage").toLowerCase();
    if (!TRANSPORT_DELIVERY_STAGES.has(stage)) {
      throw new HttpsError("invalid-argument", "Unsupported delivery stage.");
    }
    next.deliveryStage = stage;
  }

  if ("pickupLocation" in updates) {
    next.pickupLocation =
      asNullableString(updates.pickupLocation, "pickupLocation", 160) || null;
  }

  if ("market" in updates) {
    next.market = asNullableString(updates.market, "market", 120) || null;
  }

  if ("phone" in updates) {
    next.phone = asNullableString(updates.phone, "phone", 30) || "";
  }

  if ("vegetable" in updates) {
    next.vegetable = asNullableString(updates.vegetable, "vegetable", 120) || null;
  }

  if (Object.keys(next).length === 0) {
    throw new HttpsError(
      "invalid-argument",
      "No transport request updates were provided."
    );
  }

  next.updatedAt = now;

  if (linkedOrderUpdates.status && !linkedOrderUpdates.updatedAt) {
    linkedOrderUpdates.updatedAt = now;
  }

  return {
    firestoreUpdates: next,
    linkedOrderUpdates,
  };
}

exports.createOrderRequest = onCall(async (request) => {
  const buyerId = requireAuth(request);
  const buyerProfile = await assertRole(buyerId, "buyer");
  await assertRuntimeAccess(buyerProfile, { requireOrderThreads: true });

  const stockId = asNonEmptyString(request.data?.stockId, "stockId");
  const requestedQtyKg = asPositiveNumber(request.data?.requestedQtyKg, "requestedQtyKg");
  const initialMessage =
    typeof request.data?.initialMessage === "string"
      ? request.data.initialMessage.trim().slice(0, 500)
      : "";

  const stockRef = db.collection("stocks").doc(stockId);
  const orderRef = db.collection("orders").doc();
  const threadRef = db.collection("threads").doc();

  await db.runTransaction(async (tx) => {
    const stockSnap = await tx.get(stockRef);
    if (!stockSnap.exists) {
      throw new HttpsError("not-found", "Stock listing not found.");
    }

    const stock = stockSnap.data() || {};
    assertNotArchived(stock, "Stock listing");
    const farmerId = stock.farmerId;
    if (!farmerId) {
      throw new HttpsError("failed-precondition", "Stock is missing farmer owner.");
    }

    if (farmerId === buyerId) {
      throw new HttpsError("failed-precondition", "You cannot request your own stock.");
    }

    const { available, reserved } = getStockBuckets(stock);
    if (available < requestedQtyKg) {
      throw new HttpsError("failed-precondition", "Requested quantity is not available.");
    }

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + RESERVATION_TTL_MS);
    const timeline = [
      {
        status: ORDER_STATUS.REQUESTED,
        byUserId: buyerId,
        at: now,
      },
    ];

    tx.set(orderRef, {
      stockId,
      buyerId,
      farmerId,
      transporterId: null,
      requestedQtyKg,
      pricePerKg: Number(stock.price || 0),
      market: stock.market || null,
      status: ORDER_STATUS.REQUESTED,
      reservationExpiresAt: expiresAt,
      threadId: threadRef.id,
      transportRequestId: null,
      statusTimeline: timeline,
      createdAt: now,
      updatedAt: now,
    });

    tx.update(stockRef, {
      availableQtyKg: Math.max(0, available - requestedQtyKg),
      reservedQtyKg: reserved + requestedQtyKg,
      transportStatus: "reserved",
      updatedAt: now,
    });

    tx.set(threadRef, {
      orderId: orderRef.id,
      participantIds: [buyerId, farmerId],
      lastMessage: initialMessage || "Order requested",
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });

    if (initialMessage) {
      const msgRef = threadRef.collection("messages").doc();
      tx.set(msgRef, {
        senderId: buyerId,
        senderRole: buyerProfile.role,
        text: initialMessage,
        createdAt: now,
      });
    }

    queueNotification(
      tx,
      {
        recipientId: farmerId,
        type: "order_requested",
        title: "New order request",
        body: `${deriveDisplayName(buyerProfile, "Buyer")} requested ${requestedQtyKg} kg from your stock.`,
        entityType: "order",
        entityId: orderRef.id,
        actionUrl: `/dashboard/orders/${orderRef.id}`,
      },
      now
    );
  });

  return {
    ok: true,
    orderId: orderRef.id,
    threadId: threadRef.id,
  };
});

exports.respondToOrder = onCall(async (request) => {
  const farmerId = requireAuth(request);
  const farmerProfile = await assertRole(farmerId, "farmer");
  await assertRuntimeAccess(farmerProfile, { requireOrderThreads: true });

  const orderId = asNonEmptyString(request.data?.orderId, "orderId");
  const action = asNonEmptyString(request.data?.action, "action").toLowerCase();
  if (action !== "accept" && action !== "reject") {
    throw new HttpsError("invalid-argument", "action must be accept or reject.");
  }

  let acceptedPayload = null;

  await db.runTransaction(async (tx) => {
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "Order not found.");
    }

    const order = orderSnap.data() || {};
    assertNotArchived(order, "Order");
    if (order.farmerId !== farmerId) {
      throw new HttpsError("permission-denied", "You cannot respond to this order.");
    }

    if (order.status !== ORDER_STATUS.REQUESTED) {
      throw new HttpsError("failed-precondition", "Order is no longer awaiting response.");
    }

    const stockRef = db.collection("stocks").doc(order.stockId);
    const stockSnap = await tx.get(stockRef);
    if (!stockSnap.exists) {
      throw new HttpsError("failed-precondition", "Linked stock is missing.");
    }

    const stock = stockSnap.data() || {};
    assertNotArchived(stock, "Stock listing");
    const { available, reserved } = getStockBuckets(stock);
    const requestedQtyKg = asPositiveNumber(order.requestedQtyKg, "requestedQtyKg");

    const now = Timestamp.now();
    const timelineBase = Array.isArray(order.statusTimeline) ? order.statusTimeline : [];

    if (action === "reject") {
      tx.update(orderRef, {
        status: ORDER_STATUS.FARMER_REJECTED,
        updatedAt: now,
        statusTimeline: appendTimeline(timelineBase, [
          {
            status: ORDER_STATUS.FARMER_REJECTED,
            byUserId: farmerId,
            at: now,
          },
        ]),
      });

      tx.update(stockRef, {
        availableQtyKg: available + requestedQtyKg,
        reservedQtyKg: Math.max(0, reserved - requestedQtyKg),
        transportStatus: available + requestedQtyKg > 0 ? "available" : "delivered",
        updatedAt: now,
      });

      queueNotification(
        tx,
        {
          recipientId: order.buyerId,
          type: "order_rejected",
          title: "Order request rejected",
          body: "The farmer rejected your request.",
          entityType: "order",
          entityId: orderId,
          actionUrl: `/dashboard/orders/${orderId}`,
        },
        now
      );

      return;
    }

    const transportRef = db.collection("transport_requests").doc();

    tx.update(orderRef, {
      status: ORDER_STATUS.AWAITING_TRANSPORTER,
      updatedAt: now,
      transportRequestId: transportRef.id,
      statusTimeline: appendTimeline(timelineBase, [
        {
          status: ORDER_STATUS.FARMER_ACCEPTED,
          byUserId: farmerId,
          at: now,
        },
        {
          status: ORDER_STATUS.AWAITING_TRANSPORTER,
          byUserId: farmerId,
          at: now,
        },
      ]),
    });

    tx.set(transportRef, {
      orderId,
      stockId: order.stockId,
      buyerId: order.buyerId,
      farmerId: order.farmerId,
      transporterId: null,
      requestedQtyKg,
      reservationExpiresAt: order.reservationExpiresAt || null,
      status: "open",
      deliveryStage: "queued",
      vegetable: stock.vegetable || null,
      market: order.market || stock.market || null,
      pickupLocation: stock.pickupLocation || null,
      phone: stock.phone || null,
      createdAt: now,
      updatedAt: now,
    });

    tx.update(stockRef, {
      transportStatus: "awaiting_transporter",
      updatedAt: now,
    });

    queueNotification(
      tx,
      {
        recipientId: order.buyerId,
        type: "order_accepted",
        title: "Order accepted",
        body: "The farmer accepted your request. Finding a transporter now.",
        entityType: "order",
        entityId: orderId,
        actionUrl: `/dashboard/orders/${orderId}`,
      },
      now
    );

    acceptedPayload = {
      orderId,
      transportRequestId: transportRef.id,
      requestedQtyKg,
    };
  });

  if (action === "accept" && acceptedPayload) {
    const transporterSnap = await db.collection("users").where("role", "==", "transporter").get();

    const now = Timestamp.now();
    let batch = db.batch();
    let count = 0;

    for (const docSnap of transporterSnap.docs) {
      const recipientId = docSnap.id;
      const notifRef = db.collection("notifications").doc();
      batch.set(notifRef, {
        recipientId,
        type: "transport_request_open",
        title: "New transport job",
        body: `A buyer order is ready to claim (${acceptedPayload.requestedQtyKg} kg).`,
        entityType: "transport_request",
        entityId: acceptedPayload.transportRequestId,
        actionUrl: "/dashboard/transporter",
        readAt: null,
        createdAt: now,
      });
      count += 1;

      if (count >= 400) {
        await batch.commit();
        batch = db.batch();
        count = 0;
      }
    }

    if (count > 0) {
      await batch.commit();
    }
  }

  return {
    ok: true,
    orderId,
    action,
  };
});

exports.claimTransportRequest = onCall(async (request) => {
  const transporterId = requireAuth(request);
  const transporterProfile = await assertRole(transporterId, "transporter");
  await assertRuntimeAccess(transporterProfile, { requireOrderThreads: true });

  const transportRequestId = asNonEmptyString(request.data?.transportRequestId, "transportRequestId");

  let orderId = null;

  await db.runTransaction(async (tx) => {
    const activeSnap = await tx.get(
      db
        .collection("transport_requests")
        .where("transporterId", "==", transporterId)
        .where("status", "in", ACTIVE_TRANSPORT_STATUSES)
    );

    const hasOtherActive = activeSnap.docs.some((snap) => snap.id !== transportRequestId);
    if (hasOtherActive) {
      throw new HttpsError("failed-precondition", "You already have an active delivery.");
    }

    const transportRef = db.collection("transport_requests").doc(transportRequestId);
    const transportSnap = await tx.get(transportRef);
    if (!transportSnap.exists) {
      throw new HttpsError("not-found", "Transport request not found.");
    }

    const transport = transportSnap.data() || {};
    assertNotArchived(transport, "Transport request");
    if (!transport.orderId) {
      throw new HttpsError("failed-precondition", "This is a legacy transport request.");
    }

    if (transport.status !== "open") {
      throw new HttpsError("failed-precondition", "Transport request is already claimed.");
    }

    const orderRef = db.collection("orders").doc(transport.orderId);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError("failed-precondition", "Linked order does not exist.");
    }

    const order = orderSnap.data() || {};
    assertNotArchived(order, "Order");
    if (order.status !== ORDER_STATUS.AWAITING_TRANSPORTER) {
      throw new HttpsError("failed-precondition", "Order is not awaiting a transporter.");
    }

    const stockRef = db.collection("stocks").doc(order.stockId);
    const stockSnap = await tx.get(stockRef);
    if (!stockSnap.exists) {
      throw new HttpsError("failed-precondition", "Linked stock does not exist.");
    }

    const now = Timestamp.now();

    tx.update(transportRef, {
      status: "accepted",
      deliveryStage: "accepted",
      transporterId,
      claimedAt: now,
      updatedAt: now,
    });

    tx.update(orderRef, {
      status: ORDER_STATUS.IN_DELIVERY,
      transporterId,
      updatedAt: now,
      statusTimeline: appendTimeline(order.statusTimeline, [
        {
          status: ORDER_STATUS.IN_DELIVERY,
          byUserId: transporterId,
          at: now,
        },
      ]),
    });

    tx.update(stockRef, {
      transportStatus: "in_delivery",
      updatedAt: now,
    });

    if (order.threadId) {
      tx.update(db.collection("threads").doc(order.threadId), {
        participantIds: FieldValue.arrayUnion(transporterId),
        updatedAt: now,
      });
    }

    queueNotification(
      tx,
      {
        recipientId: order.buyerId,
        type: "transporter_claimed",
        title: "Transporter assigned",
        body: "A transporter claimed your delivery.",
        entityType: "order",
        entityId: orderSnap.id,
        actionUrl: `/dashboard/orders/${orderSnap.id}`,
      },
      now
    );

    queueNotification(
      tx,
      {
        recipientId: order.farmerId,
        type: "transporter_claimed",
        title: "Transporter assigned",
        body: "A transporter claimed this order.",
        entityType: "order",
        entityId: orderSnap.id,
        actionUrl: `/dashboard/orders/${orderSnap.id}`,
      },
      now
    );

    orderId = orderSnap.id;
  });

  return {
    ok: true,
    orderId,
    transportRequestId,
  };
});

exports.updateDeliveryStatus = onCall(async (request) => {
  const transporterId = requireAuth(request);
  const transporterProfile = await assertRole(transporterId, "transporter");
  await assertRuntimeAccess(transporterProfile, { requireOrderThreads: true });

  const transportRequestId = asNonEmptyString(request.data?.transportRequestId, "transportRequestId");
  const deliveryStatus = asNonEmptyString(request.data?.status, "status").toLowerCase();

  if (!DELIVERY_STATUS_INPUTS.has(deliveryStatus)) {
    throw new HttpsError("invalid-argument", "Unsupported delivery status.");
  }

  let orderId = null;

  await db.runTransaction(async (tx) => {
    const transportRef = db.collection("transport_requests").doc(transportRequestId);
    const transportSnap = await tx.get(transportRef);
    if (!transportSnap.exists) {
      throw new HttpsError("not-found", "Transport request not found.");
    }

    const transport = transportSnap.data() || {};
    assertNotArchived(transport, "Transport request");
    if (transport.transporterId !== transporterId) {
      throw new HttpsError("permission-denied", "You are not assigned to this transport request.");
    }

    if (!transport.orderId) {
      throw new HttpsError("failed-precondition", "Legacy requests are not supported here.");
    }

    const orderRef = db.collection("orders").doc(transport.orderId);
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw new HttpsError("failed-precondition", "Linked order not found.");
    }

    const order = orderSnap.data() || {};
    assertNotArchived(order, "Order");
    if (order.transporterId !== transporterId) {
      throw new HttpsError("permission-denied", "You are not assigned to this order.");
    }

    const stockRef = db.collection("stocks").doc(order.stockId);
    const stockSnap = await tx.get(stockRef);
    if (!stockSnap.exists) {
      throw new HttpsError("failed-precondition", "Linked stock not found.");
    }

    const stock = stockSnap.data() || {};
    assertNotArchived(stock, "Stock listing");
    const buckets = getStockBuckets(stock);
    const requestedQtyKg = asPositiveNumber(order.requestedQtyKg, "requestedQtyKg");

    const now = Timestamp.now();
    const timelineBase = Array.isArray(order.statusTimeline) ? order.statusTimeline : [];

    const transportUpdates = {
      updatedAt: now,
    };

    const orderUpdates = {
      updatedAt: now,
    };

    const stockUpdates = {
      updatedAt: now,
    };

    let notifyTitle = "Delivery update";
    let notifyBody = "There is an update on your order.";

    if (deliveryStatus === "accepted" || deliveryStatus === "resumed") {
      transportUpdates.status = "accepted";
      transportUpdates.deliveryStage = deliveryStatus === "resumed" ? "resumed" : "accepted";
      orderUpdates.status = ORDER_STATUS.IN_DELIVERY;
      stockUpdates.transportStatus = "in_delivery";
      notifyTitle = deliveryStatus === "resumed" ? "Delivery resumed" : "Delivery started";
      notifyBody = deliveryStatus === "resumed"
        ? "The transporter resumed this delivery."
        : "The transporter has started this delivery.";
    } else if (deliveryStatus === "paused") {
      transportUpdates.status = "paused";
      transportUpdates.deliveryStage = "paused";
      orderUpdates.status = ORDER_STATUS.IN_DELIVERY;
      stockUpdates.transportStatus = "in_delivery";
      notifyTitle = "Delivery paused";
      notifyBody = "The transporter paused this delivery.";
    } else if (deliveryStatus === "picked_up") {
      transportUpdates.status = "accepted";
      transportUpdates.deliveryStage = "picked_up";
      transportUpdates.pickedUpAt = now;
      orderUpdates.status = ORDER_STATUS.IN_DELIVERY;
      stockUpdates.transportStatus = "in_delivery";
      notifyTitle = "Stock picked up";
      notifyBody = "The stock has been picked up and is on the way.";
    } else if (deliveryStatus === "completed") {
      transportUpdates.status = "completed";
      transportUpdates.deliveryStage = "completed";
      transportUpdates.completedAt = now;
      orderUpdates.status = ORDER_STATUS.DELIVERED;
      orderUpdates.deliveredAt = now;
      stockUpdates.reservedQtyKg = Math.max(0, buckets.reserved - requestedQtyKg);
      stockUpdates.transportStatus = buckets.available > 0 ? "available" : "delivered";
      notifyTitle = "Delivery completed";
      notifyBody = "The transporter marked this order as delivered.";
    } else if (deliveryStatus === "cancelled") {
      transportUpdates.status = "open";
      transportUpdates.deliveryStage = "queued";
      transportUpdates.transporterId = null;
      orderUpdates.status = ORDER_STATUS.AWAITING_TRANSPORTER;
      orderUpdates.transporterId = null;
      stockUpdates.transportStatus = "awaiting_transporter";
      notifyTitle = "Transport reassignment needed";
      notifyBody = "The transporter cancelled this run. Waiting for a new transporter.";
    }

    tx.update(transportRef, transportUpdates);

    tx.update(orderRef, {
      ...orderUpdates,
      statusTimeline: appendTimeline(timelineBase, [
        {
          status:
            deliveryStatus === "completed"
              ? ORDER_STATUS.DELIVERED
              : deliveryStatus === "cancelled"
              ? ORDER_STATUS.AWAITING_TRANSPORTER
              : ORDER_STATUS.IN_DELIVERY,
          deliveryStatus,
          byUserId: transporterId,
          at: now,
        },
      ]),
    });

    tx.update(stockRef, stockUpdates);

    queueNotification(
      tx,
      {
        recipientId: order.buyerId,
        type: `delivery_${deliveryStatus}`,
        title: notifyTitle,
        body: notifyBody,
        entityType: "order",
        entityId: orderSnap.id,
        actionUrl: `/dashboard/orders/${orderSnap.id}`,
      },
      now
    );

    queueNotification(
      tx,
      {
        recipientId: order.farmerId,
        type: `delivery_${deliveryStatus}`,
        title: notifyTitle,
        body: notifyBody,
        entityType: "order",
        entityId: orderSnap.id,
        actionUrl: `/dashboard/orders/${orderSnap.id}`,
      },
      now
    );

    orderId = orderSnap.id;
  });

  return {
    ok: true,
    orderId,
    transportRequestId,
    status: deliveryStatus,
  };
});

exports.sendThreadMessage = onCall(async (request) => {
  const senderId = requireAuth(request);
  const senderProfile = await getUserProfile(senderId);
  ensureAccountEnabled(senderProfile);
  await assertRuntimeAccess(senderProfile, { requireOrderThreads: true });

  const threadId = asNonEmptyString(request.data?.threadId, "threadId");
  const text = asNonEmptyString(request.data?.text, "text").slice(0, 1000);

  const threadRef = db.collection("threads").doc(threadId);
  const msgRef = threadRef.collection("messages").doc();

  await db.runTransaction(async (tx) => {
    const threadSnap = await tx.get(threadRef);
    if (!threadSnap.exists) {
      throw new HttpsError("not-found", "Thread not found.");
    }

    const thread = threadSnap.data() || {};
    assertNotArchived(thread, "Thread");
    const participantIds = Array.isArray(thread.participantIds) ? thread.participantIds : [];

    if (!participantIds.includes(senderId)) {
      throw new HttpsError("permission-denied", "You are not part of this thread.");
    }

    const now = Timestamp.now();

    tx.set(msgRef, {
      senderId,
      senderRole: senderProfile.role,
      text,
      createdAt: now,
    });

    tx.update(threadRef, {
      lastMessage: text,
      lastMessageAt: now,
      updatedAt: now,
    });

    for (const recipientId of participantIds) {
      if (recipientId === senderId) continue;

      queueNotification(
        tx,
        {
          recipientId,
          type: "thread_message",
          title: "New message",
          body: `${deriveDisplayName(senderProfile, "User")}: ${text.slice(0, 80)}`,
          entityType: "thread",
          entityId: threadId,
          actionUrl: `/dashboard/orders/${thread.orderId}`,
        },
        now
      );
    }
  });

  return {
    ok: true,
    messageId: msgRef.id,
  };
});

exports.adminVerifyAccess = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    const adminProfile = await assertAdminAccess(request, { requirePassword: true });
    const runtimeConfig = await getPublicRuntimeConfig();

    return {
      ok: true,
      profile: summarizeEntity("users", adminProfile.uid, adminProfile),
      runtimeConfig: serializeValue(runtimeConfig),
    };
  }
);

exports.adminGetOverview = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    await assertAdminAccess(request, { requirePassword: true });

    const [
      usersSnap,
      stocksSnap,
      ordersSnap,
      transportSnap,
      recentAuditSnap,
      runtimeConfig,
    ] = await Promise.all([
      db.collection("users").get(),
      db.collection("stocks").get(),
      db.collection("orders").get(),
      db.collection("transport_requests").get(),
      db.collection("admin_audit_log").orderBy("createdAt", "desc").limit(6).get(),
      getPublicRuntimeConfig(),
    ]);

    const users = usersSnap.docs.map((docSnap) => docSnap.data() || {});
    const stocks = stocksSnap.docs.map((docSnap) => docSnap.data() || {});
    const orders = ordersSnap.docs.map((docSnap) => docSnap.data() || {});
    const transportRequests = transportSnap.docs.map((docSnap) => docSnap.data() || {});

    return {
      ok: true,
      runtimeConfig: serializeValue(runtimeConfig),
      overview: {
        users: {
          total: users.length,
          disabled: users.filter((entry) => entry.accountStatus === "disabled").length,
          admins: users.filter((entry) => entry.isAdmin === true).length,
        },
        stocks: {
          total: stocks.length,
          archived: stocks.filter((entry) => !!entry.archivedAt).length,
        },
        orders: {
          total: orders.length,
          archived: orders.filter((entry) => !!entry.archivedAt).length,
        },
        transportRequests: {
          total: transportRequests.length,
          archived: transportRequests.filter((entry) => !!entry.archivedAt).length,
        },
      },
      recentAudit: recentAuditSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...serializeValue(docSnap.data() || {}),
      })),
    };
  }
);

exports.adminGetRuntimeConfig = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    await assertAdminAccess(request, { requirePassword: true });
    const runtimeConfig = await getPublicRuntimeConfig();
    return {
      ok: true,
      runtimeConfig: serializeValue(runtimeConfig),
    };
  }
);

exports.adminUpdateRuntimeConfig = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    const adminProfile = await assertAdminAccess(request, { requirePassword: true });
    const patch = request.data?.config;
    if (!patch || typeof patch !== "object") {
      throw new HttpsError("invalid-argument", "config is required.");
    }

    const currentConfig = await getPublicRuntimeConfig();
    const featurePatch = patch.features && typeof patch.features === "object" ? patch.features : {};
    const sitePatch = patch.site && typeof patch.site === "object" ? patch.site : {};

    const nextConfig = mergePublicConfig({
      ...currentConfig,
      features: {
        ...currentConfig.features,
        ...Object.fromEntries(
          Object.entries(featurePatch).map(([key, value]) => [key, Boolean(value)])
        ),
      },
      site: {
        ...currentConfig.site,
        ...sitePatch,
      },
    });

    const persistedConfig = {
      features: {
        aiChatEnabled: asBoolean(
          nextConfig.features.aiChatEnabled,
          "features.aiChatEnabled"
        ),
        orderThreadsEnabled: asBoolean(
          nextConfig.features.orderThreadsEnabled,
          "features.orderThreadsEnabled"
        ),
        predictionsEnabled: asBoolean(
          nextConfig.features.predictionsEnabled,
          "features.predictionsEnabled"
        ),
        signupEnabled: asBoolean(
          nextConfig.features.signupEnabled,
          "features.signupEnabled"
        ),
        contactFormEnabled: asBoolean(
          nextConfig.features.contactFormEnabled,
          "features.contactFormEnabled"
        ),
      },
      site: {
        maintenanceEnabled: asBoolean(
          nextConfig.site.maintenanceEnabled,
          "site.maintenanceEnabled"
        ),
        maintenanceTitle:
          asNullableString(
            nextConfig.site.maintenanceTitle,
            "site.maintenanceTitle",
            120
          ) || DEFAULT_PUBLIC_CONFIG.site.maintenanceTitle,
        maintenanceMessage:
          asNullableString(
            nextConfig.site.maintenanceMessage,
            "site.maintenanceMessage",
            400
          ) || DEFAULT_PUBLIC_CONFIG.site.maintenanceMessage,
      },
      updatedAt: Timestamp.now(),
      updatedBy: adminProfile.uid,
    };

    await PUBLIC_CONFIG_REF.set(persistedConfig, { merge: true });

    const merged = mergePublicConfig(persistedConfig);

    await writeAdminAuditLog({
      actorId: adminProfile.uid,
      action: "runtime_config_updated",
      entityType: "app_config",
      entityId: "public",
      reason: asNullableString(request.data?.reason, "reason", 240),
      before: serializeValue(currentConfig),
      after: serializeValue(merged),
    });

    return {
      ok: true,
      runtimeConfig: serializeValue(merged),
    };
  }
);

exports.adminSearchEntities = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    await assertAdminAccess(request, { requirePassword: true });

    const entityType = asNonEmptyString(request.data?.entityType, "entityType");
    if (!ADMIN_ENTITY_TYPES.has(entityType)) {
      throw new HttpsError("invalid-argument", "Unsupported entity type.");
    }

    const limitCount = normalizeLimit(request.data?.limit);
    const includeArchived = request.data?.includeArchived !== false;
    const searchTerm = normalizeTextSearch(request.data?.query);

    const docs = await fetchSearchDocs(entityType, limitCount * 3);
    const items = docs
      .map((docSnap) => summarizeEntity(entityType, docSnap.id, docSnap.data()))
      .filter((item) => includeArchived || !item.archivedAt)
      .filter((item) => matchesAdminSearch(item, searchTerm))
      .slice(0, limitCount);

    return {
      ok: true,
      entityType,
      items,
    };
  }
);

exports.adminUpdateEntity = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    const adminProfile = await assertAdminAccess(request, { requirePassword: true });
    const entityType = asNonEmptyString(request.data?.entityType, "entityType");
    const entityId = asNonEmptyString(request.data?.entityId, "entityId");
    const updates = request.data?.updates;
    const reason = asNullableString(request.data?.reason, "reason", 240);

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      throw new HttpsError("invalid-argument", "updates are required.");
    }

    if (!ADMIN_ENTITY_TYPES.has(entityType)) {
      throw new HttpsError("invalid-argument", "Unsupported entity type.");
    }

    const entityRef = getEntityRef(entityType, entityId);
    const beforeSnap = await entityRef.get();
    if (!beforeSnap.exists) {
      throw new HttpsError("not-found", "Entity not found.");
    }

    const beforeData = beforeSnap.data() || {};
    const beforeSummary = summarizeEntity(entityType, entityId, beforeData);

    if (entityType === "users") {
      const { firestoreUpdates, authDisabled } = buildUserUpdates(beforeData, updates);
      await entityRef.set(firestoreUpdates, { merge: true });

      if (authDisabled !== null) {
        await admin.auth().updateUser(entityId, { disabled: authDisabled });
      }
    } else if (entityType === "stocks") {
      const { firestoreUpdates } = buildStockUpdates(beforeData, updates);
      await entityRef.set(firestoreUpdates, { merge: true });
    } else if (entityType === "orders") {
      const { firestoreUpdates, linkedTransportUpdates } = buildOrderUpdates(
        beforeData,
        updates,
        adminProfile.uid
      );

      await entityRef.set(firestoreUpdates, { merge: true });

      if (
        beforeData.transportRequestId &&
        linkedTransportUpdates &&
        Object.keys(linkedTransportUpdates).length > 0
      ) {
        await db
          .collection("transport_requests")
          .doc(beforeData.transportRequestId)
          .set(
            {
              ...linkedTransportUpdates,
              updatedAt: Timestamp.now(),
            },
            { merge: true }
          );
      }
    } else {
      const { firestoreUpdates, linkedOrderUpdates } = buildTransportUpdates(
        beforeData,
        updates,
        adminProfile.uid
      );

      await entityRef.set(firestoreUpdates, { merge: true });

      if (
        beforeData.orderId &&
        linkedOrderUpdates &&
        Object.keys(linkedOrderUpdates).length > 0
      ) {
        const orderRef = db.collection("orders").doc(beforeData.orderId);
        const orderSnap = await orderRef.get();
        const orderData = orderSnap.exists ? orderSnap.data() || {} : {};
        const orderPatch = {
          ...linkedOrderUpdates,
          updatedAt: Timestamp.now(),
        };

        if (linkedOrderUpdates.adminStatusEntry) {
          orderPatch.statusTimeline = appendTimeline(orderData.statusTimeline, [
            linkedOrderUpdates.adminStatusEntry,
          ]);
          delete orderPatch.adminStatusEntry;
        }

        await orderRef.set(orderPatch, { merge: true });
      }
    }

    const afterSnap = await entityRef.get();
    const afterSummary = summarizeEntity(entityType, entityId, afterSnap.data() || {});

    await writeAdminAuditLog({
      actorId: adminProfile.uid,
      action: "entity_updated",
      entityType,
      entityId,
      reason,
      before: beforeSummary,
      after: afterSummary,
    });

    return {
      ok: true,
      item: afterSummary,
    };
  }
);

exports.adminArchiveEntity = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    const adminProfile = await assertAdminAccess(request, { requirePassword: true });
    const entityType = asNonEmptyString(request.data?.entityType, "entityType");
    const entityId = asNonEmptyString(request.data?.entityId, "entityId");
    const archived = request.data?.archived !== false;
    const reason = asNullableString(request.data?.reason, "reason", 240);

    if (
      entityType !== "stocks" &&
      entityType !== "orders" &&
      entityType !== "transport_requests"
    ) {
      throw new HttpsError("invalid-argument", "Archiving is supported only for transactional records.");
    }

    const entityRef = getEntityRef(entityType, entityId);
    const beforeSnap = await entityRef.get();
    if (!beforeSnap.exists) {
      throw new HttpsError("not-found", "Entity not found.");
    }

    const beforeSummary = summarizeEntity(entityType, entityId, beforeSnap.data() || {});
    const timestamp = archived ? Timestamp.now() : null;

    await entityRef.set(
      {
        archivedAt: timestamp,
        archivedBy: archived ? adminProfile.uid : null,
        archivedReason: archived ? reason || null : null,
        updatedAt: Timestamp.now(),
      },
      { merge: true }
    );

    const afterSnap = await entityRef.get();
    const afterSummary = summarizeEntity(entityType, entityId, afterSnap.data() || {});

    await writeAdminAuditLog({
      actorId: adminProfile.uid,
      action: archived ? "entity_archived" : "entity_restored",
      entityType,
      entityId,
      reason,
      before: beforeSummary,
      after: afterSummary,
    });

    return {
      ok: true,
      item: afterSummary,
    };
  }
);

exports.adminListAuditLog = onCall(
  { secrets: [ADMIN_PANEL_PASSWORD] },
  async (request) => {
    await assertAdminAccess(request, { requirePassword: true });
    const limitCount = normalizeLimit(request.data?.limit, 20);

    const snap = await db
      .collection("admin_audit_log")
      .orderBy("createdAt", "desc")
      .limit(limitCount)
      .get();

    return {
      ok: true,
      items: snap.docs.map((docSnap) => ({
        id: docSnap.id,
        ...serializeValue(docSnap.data() || {}),
      })),
    };
  }
);

exports.expireSoftReservations = onSchedule(
  {
    schedule: "every 5 minutes",
    timeZone: "Asia/Colombo",
  },
  async () => {
    const now = Timestamp.now();

    const snap = await db
      .collection("orders")
      .where("status", "==", ORDER_STATUS.REQUESTED)
      .where("reservationExpiresAt", "<=", now)
      .limit(50)
      .get();

    if (snap.empty) {
      logger.info("No expirable orders found.");
      return;
    }

    let expiredCount = 0;

    for (const orderDoc of snap.docs) {
      await db.runTransaction(async (tx) => {
        const latestOrderSnap = await tx.get(orderDoc.ref);
        if (!latestOrderSnap.exists) return;

        const order = latestOrderSnap.data() || {};
        if (order.status !== ORDER_STATUS.REQUESTED) return;

        const expiresAt = order.reservationExpiresAt;
        if (!expiresAt || expiresAt.toMillis() > Date.now()) return;

        const stockRef = db.collection("stocks").doc(order.stockId);
        const stockSnap = await tx.get(stockRef);
        if (!stockSnap.exists) return;

        const stock = stockSnap.data() || {};
        const { available, reserved } = getStockBuckets(stock);
        const requestedQtyKg = asPositiveNumber(order.requestedQtyKg, "requestedQtyKg");
        const ts = Timestamp.now();

        tx.update(orderDoc.ref, {
          status: ORDER_STATUS.EXPIRED,
          updatedAt: ts,
          statusTimeline: appendTimeline(order.statusTimeline, [
            {
              status: ORDER_STATUS.EXPIRED,
              byUserId: "system",
              at: ts,
            },
          ]),
        });

        tx.update(stockRef, {
          availableQtyKg: available + requestedQtyKg,
          reservedQtyKg: Math.max(0, reserved - requestedQtyKg),
          transportStatus: available + requestedQtyKg > 0 ? "available" : "delivered",
          updatedAt: ts,
        });

        queueNotification(
          tx,
          {
            recipientId: order.buyerId,
            type: "order_expired",
            title: "Order request expired",
            body: "The request expired before the farmer responded.",
            entityType: "order",
            entityId: orderDoc.id,
            actionUrl: `/dashboard/orders/${orderDoc.id}`,
          },
          ts
        );

        queueNotification(
          tx,
          {
            recipientId: order.farmerId,
            type: "order_expired",
            title: "Order request expired",
            body: "A pending request expired automatically.",
            entityType: "order",
            entityId: orderDoc.id,
            actionUrl: `/dashboard/orders/${orderDoc.id}`,
          },
          ts
        );

        expiredCount += 1;
      });
    }

    logger.info(`Expired ${expiredCount} order reservations.`);
  }
);
