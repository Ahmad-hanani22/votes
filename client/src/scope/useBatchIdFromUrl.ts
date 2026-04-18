import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useBatchScope } from "./BatchScopeContext";

/** يقرأ `?batch=123` من الرابط ويضبط نطاق المدرسة (مثلاً بعد الضغط من صفحة الدفعات). */
export function useBatchIdFromUrl() {
  const [searchParams] = useSearchParams();
  const { setActiveBatchId } = useBatchScope();

  useEffect(() => {
    const raw = searchParams.get("batch");
    if (raw === null || raw === "") return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return;
    setActiveBatchId(n);
  }, [searchParams, setActiveBatchId]);
}
