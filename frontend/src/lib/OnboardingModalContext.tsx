import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Lets any component re-open the onboarding modal — used by the
 * SettingsModal's "Help & shortcuts" tab and the MobileTopBar hamburger
 * so the user can revisit the install walkthrough at any time.
 *
 * Auto-open at session start is owned by AppLayout (gated on
 * `user.onboarding_dismissed_at`); this context only exposes the
 * imperative reopen path.
 */
interface OnboardingState {
  open: boolean;
  openModal: () => void;
  closeModal: () => void;
}

const OnboardingModalContext = createContext<OnboardingState | undefined>(undefined);

export function OnboardingModalProvider({
  children,
  initialOpen = false,
}: {
  children: React.ReactNode;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const openModal = useCallback(() => setOpen(true), []);
  const closeModal = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ open, openModal, closeModal }),
    [open, openModal, closeModal],
  );
  return (
    <OnboardingModalContext.Provider value={value}>
      {children}
    </OnboardingModalContext.Provider>
  );
}

export function useOnboardingModal(): OnboardingState {
  const ctx = useContext(OnboardingModalContext);
  if (!ctx) throw new Error("useOnboardingModal must be used inside <OnboardingModalProvider>");
  return ctx;
}

/** Same as `useOnboardingModal` but returns null instead of throwing
 *  when no provider is mounted. Lets shared chrome like the
 *  RailFooterButtons (also used by the public/share shell) probe for
 *  the modal without crashing when it's unavailable. */
export function useOptionalOnboardingModal(): OnboardingState | null {
  return useContext(OnboardingModalContext) ?? null;
}
