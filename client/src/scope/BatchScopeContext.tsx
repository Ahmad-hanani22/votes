import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import api from "../api/client";

const STORAGE_KEY = "vms_batch_scope";

export type ImportBatch = {
  id: number;
  title: string;
  created_at: string;
  voter_count: number;
  voted_count: number;
};

type Ctx = {
  batches: ImportBatch[];
  /** null = كل الناخبين */
  activeBatchId: number | null;
  setActiveBatchId: (id: number | null) => void;
  refreshBatches: () => Promise<void>;
  activeLabel: string;
};

const BatchScopeContext = createContext<Ctx | null>(null);

export function BatchScopeProvider({ children }: { children: ReactNode }) {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [activeBatchId, setActiveBatchIdState] = useState<number | null>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw === "all" || raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });

  const refreshBatches = useCallback(async () => {
    try {
      const { data } = await api.get<ImportBatch[]>("/batches");
      setBatches(data);
    } catch {
      setBatches([]);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshBatches();
    const id = window.setInterval(() => {
      void refreshBatches();
    }, 30000);
    return () => window.clearInterval(id);
  }, [refreshBatches]);

  useEffect(() => {
    if (activeBatchId === null || batches.length === 0) return;
    if (!batches.some((b) => b.id === activeBatchId)) {
      setActiveBatchIdState(null);
      sessionStorage.setItem(STORAGE_KEY, "all");
    }
  }, [batches, activeBatchId]);

  const setActiveBatchId = useCallback((id: number | null) => {
    setActiveBatchIdState(id);
    if (id === null) sessionStorage.setItem(STORAGE_KEY, "all");
    else sessionStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const activeLabel = useMemo(() => {
    if (activeBatchId === null) return "الكل";
    const b = batches.find((x) => x.id === activeBatchId);
    return b?.title ?? `دفعة #${activeBatchId}`;
  }, [activeBatchId, batches]);

  const value = useMemo(
    () => ({ batches, activeBatchId, setActiveBatchId, refreshBatches, activeLabel }),
    [batches, activeBatchId, setActiveBatchId, refreshBatches, activeLabel]
  );

  return <BatchScopeContext.Provider value={value}>{children}</BatchScopeContext.Provider>;
}

export function useBatchScope() {
  const ctx = useContext(BatchScopeContext);
  if (!ctx) throw new Error("useBatchScope outside BatchScopeProvider");
  return ctx;
}
