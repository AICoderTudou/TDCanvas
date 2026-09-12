export const APP_VERSION = __APP_VERSION__ || "dev";

export const DOCS_URL = import.meta.env.VITE_DOC_URL?.trim() || "";

export const PLUGIN_REGISTRY_URL = import.meta.env.VITE_PLUGIN_REGISTRY_URL?.trim() || "";
export const VERSION_URL = import.meta.env.VITE_VERSION_URL?.trim() || "";
export const CHANGELOG_URL = import.meta.env.VITE_CHANGELOG_URL?.trim() || "";

// Enabled only by the signed desktop release packaging flow. Development and
// ordinary web builds keep using the lightweight release-information view.
export const DESKTOP_UPDATER_ENABLED = import.meta.env.VITE_DESKTOP_UPDATER_ENABLED === "1";
