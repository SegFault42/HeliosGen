"use client";
import { useEffect, useRef, useState } from "react";
import { useWorkflowStore } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";

export default function CreditBalance() {
  const [balance, setBalance] = useState<number | null>(null);
  const isRunning = useWorkflowStore((s) => s.isRunning);
  const prevRunning = useRef(false);

  const fetchBalance = async () => {
    try {
      const { data: { session } } = await createClient().auth.getSession();
      const headers: HeadersInit = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res = await fetch("/api/credit", { headers });
      if (!res.ok) return;
      const data = await res.json();
      const val = typeof data?.data === "number" ? data.data : (data?.data?.balance ?? data?.balance ?? null);
      setBalance(val);
    } catch {
      // silently ignore
    }
  };

  // Fetch on mount (covers page refresh)
  useEffect(() => {
    fetchBalance();
    const id = setInterval(fetchBalance, 60_000);
    return () => clearInterval(id);
  }, []);

  // Refresh when a run finishes (success or failure)
  useEffect(() => {
    if (prevRunning.current && !isRunning) {
      fetchBalance();
    }
    prevRunning.current = isRunning;
  }, [isRunning]);

  if (balance === null) return null;

  return (
    <span className="text-[11px] text-[#A0A0A0] tabular-nums">
      {balance.toLocaleString()} credits
    </span>
  );
}
