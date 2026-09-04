"use client";
// Locale-aware router: the plain next/navigation one drops the locale on
// client-side navigation.
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";

export default function useCommonState() {
  const router = useRouter();
  const [refreshFn, setRefreshFn] = useState<(() => void) | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"add" | "edit">("add");
  const [confirmType, setConfirmType] = useState<"close" | "reset" | null>(
    null,
  );
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);

  return {
    router,
    confirmType,
    setConfirmType,
    error,
    setError,
    loading,
    setLoading,
    showPreview,
    setShowPreview,
    isConfirmed,
    setIsConfirmed,
    refreshFn,
    setRefreshFn,
    modalMode,
    setModalMode,
    modalOpen,
    setModalOpen,
  };
}
