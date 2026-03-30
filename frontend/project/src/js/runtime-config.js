import { APP_ENV } from "./env";

export const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  features: {
    aiChatEnabled: APP_ENV.FEATURE_AI_CHAT,
    orderThreadsEnabled: APP_ENV.FEATURE_ORDER_THREADS,
    predictionsEnabled: APP_ENV.FEATURE_PREDICTIONS,
    signupEnabled: APP_ENV.FEATURE_SIGNUP,
    contactFormEnabled: APP_ENV.FEATURE_CONTACT_FORM,
  },
  site: {
    maintenanceEnabled: APP_ENV.SITE_MAINTENANCE_ENABLED,
    maintenanceTitle: APP_ENV.SITE_MAINTENANCE_TITLE,
    maintenanceMessage: APP_ENV.SITE_MAINTENANCE_MESSAGE,
  },
  updatedAt: null,
  updatedBy: null,
});

export function mergeRuntimeConfig(rawConfig) {
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  const features = raw.features && typeof raw.features === "object" ? raw.features : {};
  const site = raw.site && typeof raw.site === "object" ? raw.site : {};

  return {
    features: {
      aiChatEnabled:
        typeof features.aiChatEnabled === "boolean"
          ? features.aiChatEnabled
          : DEFAULT_RUNTIME_CONFIG.features.aiChatEnabled,
      orderThreadsEnabled:
        typeof features.orderThreadsEnabled === "boolean"
          ? features.orderThreadsEnabled
          : DEFAULT_RUNTIME_CONFIG.features.orderThreadsEnabled,
      predictionsEnabled:
        typeof features.predictionsEnabled === "boolean"
          ? features.predictionsEnabled
          : DEFAULT_RUNTIME_CONFIG.features.predictionsEnabled,
      signupEnabled:
        typeof features.signupEnabled === "boolean"
          ? features.signupEnabled
          : DEFAULT_RUNTIME_CONFIG.features.signupEnabled,
      contactFormEnabled:
        typeof features.contactFormEnabled === "boolean"
          ? features.contactFormEnabled
          : DEFAULT_RUNTIME_CONFIG.features.contactFormEnabled,
    },
    site: {
      maintenanceEnabled:
        typeof site.maintenanceEnabled === "boolean"
          ? site.maintenanceEnabled
          : DEFAULT_RUNTIME_CONFIG.site.maintenanceEnabled,
      maintenanceTitle:
        typeof site.maintenanceTitle === "string" && site.maintenanceTitle.trim()
          ? site.maintenanceTitle.trim()
          : DEFAULT_RUNTIME_CONFIG.site.maintenanceTitle,
      maintenanceMessage:
        typeof site.maintenanceMessage === "string" && site.maintenanceMessage.trim()
          ? site.maintenanceMessage.trim()
          : DEFAULT_RUNTIME_CONFIG.site.maintenanceMessage,
    },
    updatedAt: raw.updatedAt || null,
    updatedBy: raw.updatedBy || null,
  };
}
