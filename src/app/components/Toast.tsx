"use client";

import { useState, useCallback } from "react";

export function useToast(duration = 3000) {
    const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
    const showToast = useCallback((msg: string, type = "success") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), duration);
    }, [duration]);
    return { toast, showToast };
}

export function Toast({ toast }: { toast: { msg: string; type: string } | null }) {
    if (!toast) return null;
    return (
        <div className="toast" style={{ background: toast.type === "error" ? "var(--danger)" : "var(--success)" }}>
            {toast.msg}
        </div>
    );
}
