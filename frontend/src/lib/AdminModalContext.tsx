import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface AdminModalContextValue {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const AdminModalContext = createContext<AdminModalContextValue | null>(null);

export function AdminModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openModal, closeModal }), [open, openModal, closeModal]);
  return <AdminModalContext.Provider value={value}>{children}</AdminModalContext.Provider>;
}

export function useAdminModal() {
  const ctx = useContext(AdminModalContext);
  if (!ctx) throw new Error("useAdminModal must be used within AdminModalProvider");
  return ctx;
}
