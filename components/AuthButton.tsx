"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkflowStore } from "@/lib/store";
import type { User } from "@supabase/supabase-js";

export default function AuthButton() {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const setAuthModalOpen           = useWorkflowStore((s) => s.setAuthModalOpen);
  const setResetPasswordModalOpen  = useWorkflowStore((s) => s.setResetPasswordModalOpen);
  const supabase                   = createClient();

  useEffect(() => {
    // If the page loaded from a Supabase recovery link, establish the session
    // from the hash tokens and open the reset modal.
    // onAuthStateChange may fire before the listener is registered, so we also
    // handle this synchronously on mount.
    if (window.location.hash.includes("type=recovery")) {
      const params        = new URLSearchParams(window.location.hash.slice(1));
      const access_token  = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      if (access_token && refresh_token) {
        // Establish the session so updateUser works in the modal
        supabase.auth.setSession({ access_token, refresh_token }).then(() => {
          setResetPasswordModalOpen(true);
        });
      } else {
        setResetPasswordModalOpen(true);
      }
    }

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") {
        setResetPasswordModalOpen(true);
      }
    });
    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  if (loading) return null;

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#8D8E89] max-w-[120px] truncate hidden sm:block">
          {user.email}
        </span>
        <button onClick={signOut} className="toolbar-btn text-[11px]">
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button onClick={() => setAuthModalOpen(true)} className="toolbar-btn text-[11px]">
      Sign in
    </button>
  );
}
