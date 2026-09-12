import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

const store = localforage.createInstance({ name: "tdcanvas", storeName: "app_state" });

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            const value = await store.getItem<string>(name);
            if (value !== null) return value;
            const localValue = window.localStorage.getItem(name);
            return localValue;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await store.setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await store.removeItem(name);
        } finally {
            window.localStorage.removeItem(name);
        }
    },
};
