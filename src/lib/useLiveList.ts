import { useCallback, useEffect, useRef, useState } from "react";

// Polls only while the consuming panel is mounted. Explicit refreshes after
// mutations supersede older reads, including a poll that was already in flight.
export function useLiveList<T>(load: () => Promise<T[]>) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try {
      const result = await load();
      if (mounted.current && request === revision.current) {
        setItems(result);
        setError(null);
      }
    } catch (err) {
      if (mounted.current && request === revision.current) {
        setError(typeof err === "object" && err && "message" in err ? String(err.message) : "刷新列表失败。");
      }
      throw err;
    }
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(); } catch { /* The error is exposed to the panel. */ }
      if (!disposed) timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => {
      disposed = true;
      mounted.current = false;
      revision.current += 1;
      clearTimeout(timer);
    };
  }, [refresh]);

  return { items, error, refresh };
}
