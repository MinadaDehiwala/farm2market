import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { doc, onSnapshot } from "firebase/firestore";

import { db } from "../js/firebase";
import {
  DEFAULT_RUNTIME_CONFIG,
  mergeRuntimeConfig,
} from "../js/runtime-config";

const RuntimeConfigContext = createContext(null);

export function RuntimeConfigProvider({ children }) {
  const [config, setConfig] = useState(DEFAULT_RUNTIME_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const ref = doc(db, "app_config", "public");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        setConfig(mergeRuntimeConfig(snap.exists() ? snap.data() : null));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        console.error("Failed to load runtime config", snapshotError);
        setConfig(DEFAULT_RUNTIME_CONFIG);
        setLoading(false);
        setError("runtime-config-unavailable");
      }
    );

    return () => unsub();
  }, []);

  const value = useMemo(
    () => ({
      config,
      loading,
      error,
      features: config.features,
      site: config.site,
      isMaintenanceMode: config.site.maintenanceEnabled,
    }),
    [config, error, loading]
  );

  return (
    <RuntimeConfigContext.Provider value={value}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig() {
  const ctx = useContext(RuntimeConfigContext);
  if (!ctx) {
    throw new Error("useRuntimeConfig must be used inside RuntimeConfigProvider");
  }
  return ctx;
}
