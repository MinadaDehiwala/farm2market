import { APP_ENV } from "./env";

const DEFAULT_TIMEOUT_MS = 12000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const EMPTY_CHAT_REPLY = "No response.";
const CHAT_RESPONSE_GUIDELINES =
  "Reply in a single short paragraph (max 80 words). Use plain text only and avoid markdown, lists, and headings.";

function trimLikelyTruncatedTail(text) {
  const lines = text.split("\n");
  if (lines.length < 2) return text.trim();

  const lastLine = (lines[lines.length - 1] || "").trim();
  const isShortBullet = /^[•▪▫◦‣-]\s+/.test(lastLine) && lastLine.split(/\s+/).length <= 4;
  const hasMarkdownNoise = /[*_`#]/.test(lastLine);
  const looksIncomplete = !/[.!?]"?$/.test(lastLine);

  if (isShortBullet && (hasMarkdownNoise || looksIncomplete)) {
    lines.pop();
    return lines.join("\n").trim();
  }

  return text.trim();
}

function normalizeChatReply(text) {
  if (typeof text !== "string") return "";

  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*[▪▫◦‣]\s+/gm, "• ")
    .replace(/^\s*\d+\.\s+/gm, "• ")
    .replace(/^(\s*•\s+)\*{1,3}(?=\S)/gm, "$1")
    .replace(/^\s*\*{1,3}(?=\S)/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/(^|\s)\*(\S(?:.*?\S)?)\*(?=\s|$)/g, "$1$2")
    .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|$)/g, "$1$2")
    .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
    .replace(/[*_`#]+\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return trimLikelyTruncatedTail(cleaned);
}

export class ApiError extends Error {
  constructor(message, { status = null, code = null, details = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const joinUrl = (base, path = "") => {
  if (!path) return base;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
};

const parseJsonSafe = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const unwrapPayload = (payload, fallbackStatus = null) => {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (payload.success === true) {
    return payload.data;
  }

  if (payload.success === false) {
    const error = payload.error || {};
    throw new ApiError(error.message || "Request failed", {
      status: fallbackStatus,
      code: error.code || null,
      details: error.details ?? payload,
    });
  }

  return payload;
};

const toApiError = (error, fallbackMessage) => {
  if (error instanceof ApiError) {
    return error;
  }

  if (error?.name === "AbortError") {
    return new ApiError("Request timed out. Please try again.");
  }

  return new ApiError(fallbackMessage, { details: error?.message || null });
};

export async function request(
  path,
  {
    method = "GET",
    body,
    headers = {},
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 0,
    baseUrl = APP_ENV.API_BASE_URL,
  } = {}
) {
  const url = joinUrl(baseUrl, path);

  let attempt = 0;
  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const abortHandler = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timeoutId);
        throw new ApiError("Request cancelled by user");
      }
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

      const payload = await parseJsonSafe(response);

      if (!response.ok) {
        const message =
          payload?.error?.message ||
          payload?.detail ||
          payload?.raw ||
          `API request failed (${response.status})`;

        if (attempt < retries && RETRYABLE_STATUS.has(response.status)) {
          attempt += 1;
          continue;
        }

        throw new ApiError(message, {
          status: response.status,
          code: payload?.error?.code || null,
          details: payload,
        });
      }

      return unwrapPayload(payload, response.status);
    } catch (error) {
      if (error instanceof ApiError) {
        if (attempt < retries && RETRYABLE_STATUS.has(error.status)) {
          attempt += 1;
          continue;
        }
        throw error;
      }

      if (attempt < retries) {
        attempt += 1;
        continue;
      }

      throw toApiError(error, "Unable to reach the server right now.");
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
    }
  }

  throw new ApiError("Request failed after retries");
}

export function toUserMessage(error, fallbackMessage) {
  if (error instanceof ApiError) {
    return error.message || fallbackMessage;
  }

  return fallbackMessage;
}

export async function fetchModels(options = {}) {
  const data = await request("/models", { retries: 1, ...options });

  if (!data || !Array.isArray(data.models)) {
    return { count: 0, models: [], metadata: {} };
  }

  return {
    count: Number(data.count || data.models.length),
    models: data.models,
    metadata:
      data.metadata && typeof data.metadata === "object" ? data.metadata : {},
  };
}

export function fetchPrediction({ veg, market, start, end }, options = {}) {
  const params = new URLSearchParams({ veg, market, start, end });
  return request(`/predict?${params.toString()}`, options);
}

export async function fetchChatReply(message, options = {}) {
  const data = await request("", {
    method: "POST",
    body: {
      message,
      responseStyle: "short",
      systemInstruction: CHAT_RESPONSE_GUIDELINES,
    },
    baseUrl: APP_ENV.CHAT_API_URL,
    ...options,
  });

  if (typeof data?.reply === "string" && data.reply.trim()) {
    const normalized = normalizeChatReply(data.reply);
    return normalized || EMPTY_CHAT_REPLY;
  }

  return EMPTY_CHAT_REPLY;
}
