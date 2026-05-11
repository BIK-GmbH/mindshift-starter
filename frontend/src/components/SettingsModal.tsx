import {
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Github,
  Globe,
  Hash,
  HelpCircle,
  Image as ImageIcon,
  Languages,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Pencil,
  Plug,
  Plus,
  Puzzle,
  Star,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../lib/AuthContext";
import { useDialog } from "../lib/DialogContext";
import { useSettingsModal } from "../lib/SettingsModalContext";
import { useTheme } from "../lib/ThemeContext";
import {
  api,
  type ImageTemplateCreate,
  type ImageTemplateOut,
  type ImageTemplatePreview,
  type ImageTemplateUpdate,
  type ImageTemplateVariable,
  type MCPServerCreate,
  type MCPServerOut,
  type MCPServerUpdate,
  type TagWithCount,
} from "../lib/api";
import { getSoundsEnabled, playSound, setSoundsEnabled } from "../lib/sounds";

type SettingsTab =
  | "account"
  | "appearance"
  | "tags"
  | "extension"
  | "mcp"
  | "imageTemplates"
  | "about";

const tabs: { id: SettingsTab; labelKey: string; Icon: typeof UserRound }[] = [
  { id: "account", labelKey: "settings.tab.account", Icon: UserRound },
  { id: "appearance", labelKey: "settings.tab.appearance", Icon: SlidersHorizontal },
  { id: "tags", labelKey: "settings.tab.tags", Icon: Hash },
  { id: "extension", labelKey: "settings.tab.extension", Icon: Puzzle },
  { id: "mcp", labelKey: "settings.tab.mcp", Icon: Plug },
  { id: "imageTemplates", labelKey: "settings.tab.imageTemplates", Icon: ImageIcon },
  { id: "about", labelKey: "settings.tab.about", Icon: HelpCircle },
];

export default function SettingsModal() {
  const { open, closeModal } = useSettingsModal();
  const [active, setActive] = useState<SettingsTab>("account");
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("nav.settings")}
    >
      {/* Backdrop with blur */}
      <button
        type="button"
        onClick={closeModal}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md modal-backdrop-enter"
        aria-label="Close settings"
      />

      {/* Modal — fullscreen on mobile (h-full / w-full minus a bit of
          inset for the backdrop) so the 224 px sidebar doesn't reduce
          the content area to a 100 px sliver. Desktop keeps 920 × 640
          centered. */}
      <div className="relative flex h-[100vh] w-[100vw] max-h-none max-w-none flex-col overflow-hidden border-0 bg-ink-800 surface-elevated modal-card-enter sm:h-[640px] sm:w-[920px] sm:max-h-[85vh] sm:max-w-[92vw] sm:flex-row sm:rounded-2xl sm:border sm:border-ink-700">
        {/* Tabs nav — horizontal scrollable strip on mobile, vertical
            sidebar on sm+. */}
        <aside className="flex flex-shrink-0 flex-row gap-0.5 overflow-x-auto border-b border-ink-700 bg-ink-900/40 p-2 sm:w-56 sm:flex-col sm:gap-0.5 sm:border-b-0 sm:border-r sm:p-3">
          <nav className="flex flex-1 flex-row gap-0.5 sm:flex-col" aria-label="settings sections">
            {tabs.map(({ id, labelKey, Icon }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={[
                    "flex flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition sm:gap-2.5",
                    isActive
                      ? "bg-ink-700/80 text-ink-100 ring-1 ring-ink-600"
                      : "text-ink-300 active:bg-ink-700/60 hover:bg-ink-700/40 hover:text-ink-100",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex flex-shrink-0 items-center justify-between border-b border-ink-700 px-4 py-3 sm:px-6 sm:py-4">
            <h2 className="text-base font-semibold text-ink-100">
              {t(tabs.find((tab) => tab.id === active)?.labelKey ?? "")}
            </h2>
            <button
              type="button"
              onClick={closeModal}
              className="rounded-lg p-1.5 text-ink-300 transition hover:bg-ink-700/60 hover:text-ink-100"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            {active === "account" && <AccountTab />}
            {active === "appearance" && <AppearanceTab />}
            {active === "tags" && <TagsTab />}
            {active === "extension" && <ExtensionTab />}
            {active === "mcp" && <MCPServersTab />}
            {active === "imageTemplates" && <ImageTemplatesTab />}
            {active === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountTab() {
  const { t } = useTranslation();
  const { user, signOut, refreshUser } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    display_name: user?.display_name ?? "",
    username: user?.username ?? "",
    bio: user?.bio ?? "",
    public_profile: user?.public_profile ?? false,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  useEffect(() => {
    setProfileDraft({
      display_name: user?.display_name ?? "",
      username: user?.username ?? "",
      bio: user?.bio ?? "",
      public_profile: user?.public_profile ?? false,
    });
  }, [user]);

  const saveProfile = async () => {
    setProfileSaving(true);
    setProfileError(null);
    try {
      await api.updateProfile({
        display_name: profileDraft.display_name.trim() || null,
        username: profileDraft.username.trim().toLowerCase() || null,
        bio: profileDraft.bio.trim() || null,
        public_profile: profileDraft.public_profile,
      });
      await refreshUser();
      setProfileSaved(true);
      window.setTimeout(() => setProfileSaved(false), 1800);
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setProfileSaving(false);
    }
  };

  const onAvatarPick = async (file: File | null | undefined) => {
    if (!file) return;
    setAvatarBusy(true);
    setProfileError(null);
    try {
      await api.uploadAvatar(file);
      await refreshUser();
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarBusy(true);
    try {
      await api.removeAvatar();
      await refreshUser();
    } catch (err) {
      setProfileError((err as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const onExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem("mindshift.token");
      const res = await fetch(api.exportMarkdownUrl(), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `mindshift-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-ink-700 bg-ink-900/30 p-5">
        <div className="flex items-center gap-4">
          <Avatar user={user} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink-100">
              {user?.display_name ?? user?.email}
            </p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-ink-400">
              <Mail className="h-3 w-3" />
              {user?.email}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="h-3 w-3" />
            {t("auth.signOut")}
          </button>
        </div>
      </div>

      {/* Public profile */}
      <div className="space-y-4 rounded-xl border border-ink-700 bg-ink-900/30 p-5">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            {t("settings.profile.heading", { defaultValue: "Public profile" })}
          </h3>
          <p className="mt-1 text-xs text-ink-400">
            {t("settings.profile.body", {
              defaultValue:
                "Pick a username and toggle on the public profile. Tags you mark as public will show up on your profile page.",
            })}
          </p>
        </div>

        <div className="flex items-start gap-4">
          <Avatar user={user} large />
          <div className="flex flex-col gap-2 text-xs">
            <button
              type="button"
              onClick={() => avatarRef.current?.click()}
              disabled={avatarBusy}
              className="rounded-md border border-ink-700 px-3 py-1.5 text-ink-200 transition hover:border-ink-500 hover:bg-ink-700/40 disabled:opacity-50"
            >
              {avatarBusy ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null}
              {t("settings.profile.uploadAvatar", { defaultValue: "Upload avatar" })}
            </button>
            {user?.avatar_file_id && (
              <button
                type="button"
                onClick={() => void removeAvatar()}
                disabled={avatarBusy}
                className="rounded-md border border-transparent px-3 py-1.5 text-ink-400 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
              >
                {t("settings.profile.removeAvatar", { defaultValue: "Remove" })}
              </button>
            )}
            <input
              ref={avatarRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(e) => void onAvatarPick(e.target.files?.[0])}
            />
            <span className="text-[10px] text-ink-500">
              {t("settings.profile.avatarHint", { defaultValue: "PNG / JPEG / WebP — up to 2 MiB" })}
            </span>
          </div>
        </div>

        <FieldLabel label={t("settings.profile.displayName", { defaultValue: "Display name" })}>
          <input
            value={profileDraft.display_name}
            onChange={(e) => setProfileDraft((p) => ({ ...p, display_name: e.target.value }))}
            className="w-full rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2 text-sm text-ink-100"
          />
        </FieldLabel>

        <FieldLabel label={t("settings.profile.username", { defaultValue: "Username" })}>
          <div className="flex items-center gap-1 text-sm text-ink-400">
            <span className="select-none">/u/</span>
            <input
              value={profileDraft.username}
              onChange={(e) =>
                setProfileDraft((p) => ({
                  ...p,
                  username: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                }))
              }
              placeholder="chris"
              className="flex-1 rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2 text-ink-100"
            />
          </div>
          <p className="mt-1 text-[10px] text-ink-500">
            {t("settings.profile.usernameHint", {
              defaultValue: "3–32 characters. Lowercase letters, numbers and dashes.",
            })}
          </p>
        </FieldLabel>

        <FieldLabel label={t("settings.profile.bio", { defaultValue: "Bio" })}>
          <textarea
            value={profileDraft.bio}
            onChange={(e) => setProfileDraft((p) => ({ ...p, bio: e.target.value }))}
            rows={3}
            maxLength={400}
            placeholder={t("settings.profile.bioPlaceholder", {
              defaultValue: "Tell visitors what your knowledge base is about.",
            })}
            className="w-full resize-none rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2 text-sm text-ink-100"
          />
        </FieldLabel>

        <label className="flex items-start gap-2 rounded-md border border-ink-700 bg-ink-800/40 px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={profileDraft.public_profile}
            onChange={(e) => setProfileDraft((p) => ({ ...p, public_profile: e.target.checked }))}
            className="mt-0.5 h-3.5 w-3.5"
          />
          <span className="flex-1">
            <span className="text-ink-100">
              {t("settings.profile.public", { defaultValue: "Make profile public" })}
            </span>
            <span className="block text-[11px] text-ink-400">
              {t("settings.profile.publicHint", {
                defaultValue:
                  "Anyone with the link to /u/<username> can see your profile and any public tags.",
              })}
            </span>
          </span>
        </label>

        {profileError && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{profileError}</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* "Open profile" — visible as soon as the saved user has a
              username AND has the profile toggled public (otherwise
              /u/<username> returns 404). When username is set but the
              public toggle is off, we show a small inline hint instead
              of a dead button. */}
          {user?.username && user.public_profile && (
            <a
              href={`/u/${user.username}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 bg-ink-800/40 px-3 py-1.5 text-xs font-medium text-ink-200 transition hover:bg-ink-800 hover:text-ink-100"
              title={`/u/${user.username}`}
            >
              <ExternalLink className="h-3 w-3" />
              {t("settings.profile.viewProfile", { defaultValue: "Profil öffnen" })}
              <span className="hidden text-ink-500 sm:inline">/u/{user.username}</span>
            </a>
          )}
          {user?.username && !user.public_profile && (
            <span className="mr-auto text-[11px] text-ink-500">
              {t("settings.profile.enablePublicHint", {
                defaultValue:
                  "Aktiviere „Profil öffentlich“, um deine Seite zu teilen.",
              })}
            </span>
          )}
          <button
            type="button"
            onClick={() => void saveProfile()}
            disabled={profileSaving}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
          >
            {profileSaving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : profileSaved ? (
              <Check className="h-3 w-3" />
            ) : null}
            {profileSaved
              ? t("settings.profile.saved", { defaultValue: "Saved" })
              : t("common.save")}
          </button>
        </div>
      </div>

      {/* Data export */}
      <div className="rounded-xl border border-ink-700 bg-ink-900/30 p-5">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          {t("settings.export.heading")}
        </h3>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink-100">
              {t("settings.export.title")}
            </p>
            <p className="mt-0.5 text-xs text-ink-400">
              {t("settings.export.body")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-200 transition hover:border-ink-500 hover:bg-ink-700/40 disabled:opacity-50"
          >
            <Download className="h-3 w-3" />
            {exporting ? t("common.loading") : t("settings.export.action")}
          </button>
        </div>
      </div>
    </section>
  );
}

const AUTO_TRANSLATE_OPTIONS = [
  "Deutsch",
  "English",
  "Français",
  "Español",
  "Italiano",
  "Português",
  "Nederlands",
  "Polski",
  "日本語",
  "中文",
];

function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const current = i18n.resolvedLanguage ?? "en";
  const [soundsOn, setSoundsOn] = useState<boolean>(() => getSoundsEnabled());
  const [defaultLang, setDefaultLang] = useState<string | null>(null);
  const [defaultLangSaving, setDefaultLangSaving] = useState(false);

  // Load the default-translation-language preference once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs = await api.getPreferences();
        if (!cancelled) setDefaultLang(prefs.default_translation_language);
      } catch {
        /* preferences endpoint missing — leave the dropdown on "Off" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDefault = async (value: string | null) => {
    setDefaultLangSaving(true);
    try {
      const updated = await api.updatePreferences({ default_translation_language: value });
      setDefaultLang(updated.default_translation_language);
    } catch {
      /* surface failure on next reload — toast infrastructure is
         heavy for a one-shot save and the picker UI re-renders the
         current state if the save silently fails */
    } finally {
      setDefaultLangSaving(false);
    }
  };

  const toggleSounds = () => {
    const next = !soundsOn;
    setSoundsEnabled(next);
    setSoundsOn(next);
    if (next) playSound("click"); // immediate audible confirmation
  };

  return (
    <section className="space-y-7">
      {/* Theme picker */}
      <div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          {t("settings.appearance.theme")}
        </label>
        <div className="grid grid-cols-3 gap-2">
          <ThemeChoice
            active={theme === "dark"}
            onClick={() => setTheme("dark")}
            Icon={Moon}
            label={t("settings.appearance.dark")}
          />
          <ThemeChoice
            active={theme === "light"}
            onClick={() => setTheme("light")}
            Icon={Sun}
            label={t("settings.appearance.light")}
          />
          <ThemeChoice
            active={false}
            onClick={() => undefined}
            Icon={Monitor}
            label={t("settings.appearance.system")}
            disabled
          />
        </div>
      </div>

      {/* Language picker */}
      <div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          {t("settings.appearance.language")}
        </label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { code: "de", label: "Deutsch" },
            { code: "en", label: "English" },
          ].map(({ code, label }) => {
            const isActive = current.startsWith(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => void i18n.changeLanguage(code)}
                className={[
                  "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm transition",
                  isActive
                    ? "border-ink-100 bg-ink-100 text-ink-900"
                    : "border-ink-700 bg-ink-900/40 text-ink-200 hover:border-ink-600",
                ].join(" ")}
              >
                <Languages className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Default translation language — auto-translates every newly
          embedded card to this language on first paint. Dropdown so
          ten options don't bloat the modal vertically. */}
      <div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          {t("settings.appearance.defaultTranslation", {
            defaultValue: "Default translation language",
          })}
        </label>
        <div className="flex items-center gap-2">
          <select
            value={defaultLang ?? ""}
            onChange={(e) => void setDefault(e.target.value || null)}
            disabled={defaultLangSaving}
            className="flex-1 rounded-lg border border-ink-700 bg-ink-900/40 px-3 py-2.5 text-sm text-ink-100 transition focus:border-ink-500 focus:outline-none disabled:opacity-50"
          >
            <option value="">
              {t("settings.appearance.defaultTranslationOff", {
                defaultValue: "Off — keep cards in their original language",
              })}
            </option>
            {AUTO_TRANSLATE_OPTIONS.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
            {/* Render an extra option when the user has a custom
                language stored (e.g. set via the side-panel picker
                with a free-form prompt) so the select renders the
                current value and doesn't silently revert to "Off". */}
            {defaultLang && !AUTO_TRANSLATE_OPTIONS.includes(defaultLang) && (
              <option value={defaultLang}>{defaultLang}</option>
            )}
          </select>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-500">
          {t("settings.appearance.defaultTranslationHint", {
            defaultValue:
              "Applies to the browser-extension side panel only. The main app keeps the original language.",
          })}
        </p>
      </div>

      {/* UI sounds toggle */}
      <div>
        <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-400">
          {t("settings.appearance.sounds", { defaultValue: "UI sounds" })}
        </label>
        <button
          type="button"
          onClick={toggleSounds}
          className={[
            "flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm transition",
            soundsOn
              ? "border-ink-100 bg-ink-100/10 text-ink-100"
              : "border-ink-700 bg-ink-900/40 text-ink-200 hover:border-ink-600",
          ].join(" ")}
        >
          <span className="inline-flex items-center gap-2">
            <Volume2 className="h-3.5 w-3.5" />
            {t("settings.appearance.soundsBody", {
              defaultValue: "Subtle ticks on nav, buttons and quiz answers.",
            })}
          </span>
          <span
            className={[
              "h-4 w-7 rounded-full p-[2px] transition",
              soundsOn ? "bg-ink-100" : "bg-ink-700",
            ].join(" ")}
          >
            <span
              className={[
                "block h-3 w-3 rounded-full bg-ink-900 transition",
                soundsOn ? "translate-x-3" : "translate-x-0",
              ].join(" ")}
            />
          </span>
        </button>
      </div>
    </section>
  );
}

function ThemeChoice({
  active,
  onClick,
  Icon,
  label,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  Icon: typeof Moon;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex flex-col items-center gap-2 rounded-lg border px-4 py-4 text-sm transition",
        active
          ? "border-ink-100 bg-ink-100 text-ink-900"
          : "border-ink-700 bg-ink-900/40 text-ink-200 hover:border-ink-600",
        disabled ? "cursor-not-allowed opacity-40" : "",
      ].join(" ")}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
}

function TagsTab() {
  const { t } = useTranslation();
  const { confirm, prompt } = useDialog();
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listTags();
      setTags(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const tree = useMemo(() => buildTagTree(tags), [tags]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await api.createTag(name);
    setNewName("");
    void refresh();
  };

  const onRename = async (tag: TagWithCount) => {
    const next = await prompt({
      title: t("settings.tags.renameTitle", { defaultValue: "Rename tag" }),
      body: t("settings.tags.renameBody", {
        defaultValue: "Pick a new name. Cards stay attached to the tag.",
      }),
      defaultValue: tag.name,
      confirmLabel: t("common.save"),
    });
    const trimmed = next?.trim();
    if (!trimmed || trimmed === tag.name) return;
    await api.updateTag(tag.id, { name: trimmed });
    void refresh();
  };

  const onDelete = async (tag: TagWithCount) => {
    const ok = await confirm({
      title: t("settings.tags.confirmDelete") + ` "${tag.name}"?`,
      body: t("settings.tags.deleteBody", {
        defaultValue:
          "Cards keep their content but lose this tag. Children of the tag move up one level.",
      }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await api.deleteTag(tag.id);
    void refresh();
  };

  const togglePublic = async (tag: TagWithCount) => {
    await api.updateTag(tag.id, { is_public: !tag.is_public });
    void refresh();
  };

  const onChangeParent = async (tag: TagWithCount, parentId: string | null) => {
    await api.updateTag(tag.id, { parent_id: parentId });
    void refresh();
  };

  return (
    <section className="space-y-4">
      <p className="text-xs text-ink-400">{t("settings.tags.subtitle")}</p>

      <form onSubmit={onCreate} className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={t("tags.newTagPlaceholder") ?? ""}
          className="flex-1 rounded-md border border-ink-700 bg-ink-900/40 px-3 py-1.5 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-700/40"
        />
        <button
          type="submit"
          disabled={!newName.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.tags.add")}
        </button>
      </form>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}

      {loading ? (
        <p className="text-xs text-ink-400">{t("common.loading")}</p>
      ) : tags.length === 0 ? (
        <p className="rounded-md border border-dashed border-ink-700 px-4 py-6 text-center text-xs text-ink-400">
          {t("settings.tags.empty")}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-ink-700">
          <table className="w-full text-sm">
            <thead className="border-b border-ink-700 bg-ink-900/40 text-[10px] uppercase tracking-wider text-ink-500">
              <tr>
                <th className="px-3 py-2 text-left">{t("settings.tags.name")}</th>
                <th className="px-3 py-2 text-left">{t("settings.tags.parent")}</th>
                <th className="px-3 py-2 text-right">{t("settings.tags.cards")}</th>
                <th className="px-3 py-2 text-center">{t("settings.tags.public", { defaultValue: "Public" })}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {tree.map(({ tag, depth }) => (
                <tr key={tag.id} className="border-t border-ink-800">
                  <td className="px-3 py-2">
                    <span style={{ paddingLeft: depth * 16 }} className="inline-flex items-center gap-1.5 text-ink-100">
                      {depth > 0 && <ChevronRight className="h-3 w-3 text-ink-500" />}
                      <Hash className="h-3 w-3 text-ink-400" />
                      {tag.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-300">
                    <select
                      value={tag.parent_id ?? ""}
                      onChange={(e) => void onChangeParent(tag, e.target.value || null)}
                      className="rounded-md border border-ink-700 bg-ink-900/40 px-2 py-0.5 text-xs text-ink-200"
                    >
                      <option value="">—</option>
                      {tags
                        .filter((other) => other.id !== tag.id && !isDescendant(tags, other.id, tag.id))
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.name}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-300">{tag.count}</td>
                  <td className="px-3 py-2 text-center">
                    <button
                      type="button"
                      onClick={() => void togglePublic(tag)}
                      title={
                        tag.is_public
                          ? t("settings.tags.makePrivate", { defaultValue: "Make private" })
                          : t("settings.tags.makePublic", { defaultValue: "Make public" })
                      }
                      aria-label={tag.is_public ? "Public" : "Private"}
                      className={[
                        "inline-flex items-center justify-center rounded-md p-1 transition",
                        tag.is_public
                          ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/25"
                          : "text-ink-400 hover:bg-ink-700/40 hover:text-ink-100",
                      ].join(" ")}
                    >
                      {tag.is_public ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => void onRename(tag)}
                        className="rounded p-1 text-ink-400 hover:bg-ink-700/40 hover:text-ink-100"
                        title={t("settings.tags.rename") ?? ""}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDelete(tag)}
                        className="rounded p-1 text-ink-400 hover:bg-red-500/10 hover:text-red-300"
                        title={t("settings.tags.delete") ?? ""}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface FlatTagRow {
  tag: TagWithCount;
  depth: number;
}

function buildTagTree(tags: TagWithCount[]): FlatTagRow[] {
  const byParent = new Map<string | null, TagWithCount[]>();
  for (const t of tags) {
    const key = t.parent_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(t);
  }
  const result: FlatTagRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    const children = (byParent.get(parentId) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const c of children) {
      result.push({ tag: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return result;
}

function isDescendant(tags: TagWithCount[], candidateId: string, ancestorId: string): boolean {
  const byId = new Map(tags.map((t) => [t.id, t]));
  let cur = byId.get(candidateId);
  while (cur && cur.parent_id) {
    if (cur.parent_id === ancestorId) return true;
    cur = byId.get(cur.parent_id);
  }
  return false;
}

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
      <span className="block mb-1.5">{label}</span>
      <div className="block">{children}</div>
    </label>
  );
}

function Avatar({
  user,
  large = false,
}: {
  user: { display_name?: string | null; email?: string; avatar_file_id?: string | null } | null;
  large?: boolean;
}) {
  const size = large ? "h-16 w-16" : "h-12 w-12";
  if (user?.avatar_file_id) {
    return (
      <img
        src={api.publicAvatarUrl(user.avatar_file_id)}
        alt=""
        className={`${size} flex-shrink-0 rounded-full object-cover ring-1 ring-ink-700`}
      />
    );
  }
  const initial = (user?.display_name || user?.email || "?")[0]?.toUpperCase() ?? "?";
  return (
    <div
      className={`${size} flex flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-100 to-ink-300 font-semibold text-ink-900`}
    >
      {initial}
    </div>
  );
}

function ExtensionTab() {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBase =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    `${window.location.protocol}//${window.location.hostname}:8001`;

  const reveal = async () => {
    setRevealing(true);
    setError(null);
    try {
      const res = await api.createExtensionToken();
      setToken(res.access_token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRevealing(false);
    }
  };

  const rotate = async () => {
    setToken(null);
    void reveal();
  };

  const copy = async () => {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-ink-700 bg-ink-900/30 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-ink-700/60">
            <Puzzle className="h-4 w-4 text-ink-200" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-medium text-ink-100">
              {t("settings.extension.title", { defaultValue: "Browser extension" })}
            </h3>
            <p className="text-xs text-ink-400">
              {t("settings.extension.body", {
                defaultValue:
                  "Save the current page or your bookmarks tree from a single click in the toolbar. Install the unpacked extension from the `extension/` folder, then paste the token + API URL below into its popup.",
              })}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border border-ink-700 bg-ink-900/30 p-5">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          {t("settings.extension.apiHeading", { defaultValue: "API URL" })}
        </h3>
        <div className="flex w-full items-stretch overflow-hidden rounded-md border border-ink-700 bg-ink-800/40">
          <input
            type="text"
            readOnly
            value={apiBase}
            onFocus={(e) => e.currentTarget.select()}
            className="block min-w-0 flex-1 truncate bg-transparent px-3 py-2 text-xs text-ink-200 focus:outline-none"
            aria-label="API URL"
          />
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(apiBase)}
            className="flex flex-shrink-0 items-center justify-center border-l border-ink-700 px-3 text-ink-400 transition hover:bg-ink-700/60 hover:text-ink-100"
            aria-label="Copy API URL"
            title={t("share.copy", { defaultValue: "Copy" })}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-ink-700 bg-ink-900/30 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
              {t("settings.extension.tokenHeading", { defaultValue: "Token" })}
            </h3>
            <p className="mt-1 text-xs text-ink-400">
              {t("settings.extension.tokenBody", {
                defaultValue:
                  "Long-lived (1 year). Treat it like a password — anyone with the token can write to your knowledge base.",
              })}
            </p>
          </div>
          {token && (
            <button
              type="button"
              onClick={() => void rotate()}
              className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-300 transition hover:bg-ink-700/40 hover:text-ink-100"
              title={t("settings.extension.rotate", { defaultValue: "Rotate token" })}
            >
              <RefreshCw className="h-3 w-3" />
              {t("settings.extension.rotate", { defaultValue: "Rotate" })}
            </button>
          )}
        </div>

        {error && (
          <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
        )}

        {token ? (
          // Read-only input is more robust than a <code>: the browser
          // already handles overflow + selection sanely, and clicking
          // it selects the whole value for manual copy as a fallback.
          <div className="flex w-full items-stretch gap-0 overflow-hidden rounded-md border border-ink-700 bg-ink-800/40">
            <input
              type="text"
              readOnly
              value={token}
              onFocus={(e) => e.currentTarget.select()}
              className="block min-w-0 flex-1 truncate bg-transparent px-3 py-2 font-mono text-[11px] text-ink-200 focus:outline-none"
              aria-label={t("settings.extension.tokenHeading", { defaultValue: "Token" })}
            />
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex flex-shrink-0 items-center gap-1 border-l border-ink-700 bg-ink-100 px-3 text-[11px] font-semibold text-ink-900 transition hover:bg-ink-200"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied
                ? t("share.copied", { defaultValue: "Copied" })
                : t("share.copy", { defaultValue: "Copy" })}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void reveal()}
            disabled={revealing}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-2 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
          >
            {revealing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Puzzle className="h-3 w-3" />}
            {t("settings.extension.reveal", { defaultValue: "Reveal token" })}
          </button>
        )}
      </div>
    </section>
  );
}

function AboutTab() {
  const { t } = useTranslation();
  return (
    <section className="space-y-3 text-sm text-ink-300">
      <p>
        <span className="font-medium text-ink-100">{t("app.name")}</span> — {t("app.tagline")}.
      </p>
      <p className="text-xs text-ink-400">{t("settings.aboutBody")}</p>
      <a
        href="https://github.com/BIK-GmbH/mindshift-starter"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-ink-300 transition hover:text-ink-100"
      >
        <Github className="h-3 w-3" />
        BIK-GmbH/mindshift-starter
      </a>
    </section>
  );
}

/* ----------------------------------------------------------------------
 * MCP servers — generic third-party tool integrations.
 * -------------------------------------------------------------------- */
function MCPServersTab() {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [servers, setServers] = useState<MCPServerOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.listMCPServers();
      setServers(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const onTest = async (id: string) => {
    setTestingId(id);
    setError(null);
    try {
      const r = await api.testMCPServer(id);
      if (!r.ok) setError(r.error ?? "Connection failed");
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTestingId(null);
    }
  };

  const onDelete = async (server: MCPServerOut) => {
    const ok = await confirm({
      title: t("settings.mcp.confirmDeleteTitle", { defaultValue: "Remove this MCP server?" }),
      body:
        t("settings.mcp.confirmDeleteBody", {
          name: server.name,
          defaultValue:
            'Mindshift will stop calling tools on "{{name}}" and the cached tool list will be removed. Re-add it later to reconnect.',
        }) ?? "",
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteMCPServer(server.id);
      setServers((prev) => prev.filter((s) => s.id !== server.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-100">
            {t("settings.mcp.heading", { defaultValue: "MCP Servers" })}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            {t("settings.mcp.body", {
              defaultValue:
                "Plug third-party Model Context Protocol servers into Mindshift. Their tools become available to features like the Posts tab's „Publish via …\" — for example a LinkedIn / X publishing MCP. Auth tokens are encrypted at rest.",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.mcp.addServer", { defaultValue: "Add server" })}
        </button>
      </header>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}

      {creating && (
        <MCPServerForm
          mode="create"
          onSubmit={async (body) => {
            try {
              const created = await api.createMCPServer(body as MCPServerCreate);
              setServers((prev) => [created, ...prev]);
              setCreating(false);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-ink-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("common.loading")}
        </p>
      ) : servers.length === 0 && !creating ? (
        <p className="rounded-lg border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-400">
          {t("settings.mcp.empty", {
            defaultValue: "No MCP servers yet. Click „Add server\" to register one.",
          })}
        </p>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={s.id}>
              {editingId === s.id ? (
                <MCPServerForm
                  mode="edit"
                  initial={s}
                  onSubmit={async (body) => {
                    try {
                      const updated = await api.updateMCPServer(s.id, body);
                      setServers((prev) =>
                        prev.map((row) => (row.id === s.id ? updated : row)),
                      );
                      setEditingId(null);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <MCPServerRow
                  server={s}
                  testing={testingId === s.id}
                  onTest={() => void onTest(s.id)}
                  onEdit={() => {
                    setEditingId(s.id);
                    setCreating(false);
                  }}
                  onDelete={() => void onDelete(s)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MCPServerRow({
  server,
  testing,
  onTest,
  onEdit,
  onDelete,
}: {
  server: MCPServerOut;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Plug className="h-3.5 w-3.5 text-violet-300" />
            <p className="truncate text-sm font-semibold text-ink-100">{server.name}</p>
            {!server.is_active && (
              <span className="rounded-full bg-ink-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-400">
                {t("settings.mcp.paused", { defaultValue: "paused" })}
              </span>
            )}
            <span className="rounded-full bg-ink-700/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-300">
              {server.transport}
            </span>
            {server.has_auth_secret && (
              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                {t("settings.mcp.authed", { defaultValue: "authed" })}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-500">{server.url}</p>
          {server.last_error ? (
            <p className="mt-1 truncate text-[11px] text-red-300" title={server.last_error}>
              {server.last_error}
            </p>
          ) : server.last_connected_at ? (
            <p className="mt-1 text-[11px] text-ink-500">
              {t("settings.mcp.lastConnected", {
                defaultValue: "Last connected: {{when}}",
                when: new Date(server.last_connected_at).toLocaleString(),
              })}
            </p>
          ) : null}
          {server.tools.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {server.tools.map((tool) => (
                <span
                  key={tool.id}
                  title={tool.description ?? ""}
                  className="inline-flex items-center rounded-md bg-ink-700/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-200"
                >
                  {tool.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onTest}
            disabled={testing}
            className="inline-flex items-center gap-1 rounded-md border border-ink-700 px-2 py-1 text-[11px] text-ink-200 transition hover:bg-ink-800 disabled:opacity-50"
            title={t("settings.mcp.test", { defaultValue: "Test connection" }) ?? ""}
          >
            {testing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {testing
              ? t("settings.mcp.testing", { defaultValue: "Testing…" })
              : t("settings.mcp.test", { defaultValue: "Test" })}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800"
            title={t("common.edit", { defaultValue: "Edit" }) ?? "Edit"}
            aria-label={t("common.edit", { defaultValue: "Edit" }) ?? "Edit"}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-red-500/10 hover:text-red-300"
            title={t("common.delete") ?? ""}
            aria-label={t("common.delete") ?? "Delete"}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MCPServerForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: MCPServerOut;
  onSubmit: (body: MCPServerCreate | MCPServerUpdate) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    url: initial?.url ?? "",
    transport: (initial?.transport ?? "http") as "http" | "sse",
    auth_type: (initial?.auth_type ?? "none") as "none" | "bearer" | "header",
    auth_secret: "",
    auth_header_name: initial?.auth_header_name ?? "",
    is_active: initial?.is_active ?? true,
  });

  const submit = async () => {
    setBusy(true);
    try {
      const body: MCPServerCreate | MCPServerUpdate = {
        name: form.name.trim(),
        url: form.url.trim(),
        transport: form.transport,
        auth_type: form.auth_type,
        auth_header_name:
          form.auth_type === "header" ? form.auth_header_name.trim() || null : null,
        is_active: form.is_active,
      };
      // Only send auth_secret when the user typed something — empty string
      // means "clear the secret", undefined means "leave unchanged".
      if (form.auth_type === "none") {
        body.auth_secret = "";
      } else if (form.auth_secret) {
        body.auth_secret = form.auth_secret;
      }
      await onSubmit(body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-4">
      <h4 className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-200">
        <Plug className="h-3 w-3" />
        {mode === "create"
          ? t("settings.mcp.formCreate", { defaultValue: "Add MCP server" })
          : t("settings.mcp.formEdit", { defaultValue: "Edit MCP server" })}
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <FieldLabel label={t("settings.mcp.name", { defaultValue: "Name" })}>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Triple"
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
          />
        </FieldLabel>
        <FieldLabel label={t("settings.mcp.transport", { defaultValue: "Transport" })}>
          <select
            value={form.transport}
            onChange={(e) =>
              setForm((f) => ({ ...f, transport: e.target.value as "http" | "sse" }))
            }
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
          >
            <option value="http">HTTP (Streamable)</option>
            <option value="sse">SSE</option>
          </select>
        </FieldLabel>
        <div className="sm:col-span-2">
          <FieldLabel label={t("settings.mcp.url", { defaultValue: "Server URL" })}>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://mcp.example.com/v1"
              className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 font-mono focus:border-ink-500 focus:outline-none"
            />
          </FieldLabel>
        </div>
        <FieldLabel label={t("settings.mcp.authType", { defaultValue: "Auth" })}>
          <select
            value={form.auth_type}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                auth_type: e.target.value as "none" | "bearer" | "header",
              }))
            }
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
          >
            <option value="none">No auth</option>
            <option value="bearer">Bearer token</option>
            <option value="header">Custom header</option>
          </select>
        </FieldLabel>
        {form.auth_type === "header" && (
          <FieldLabel label={t("settings.mcp.authHeader", { defaultValue: "Header name" })}>
            <input
              type="text"
              value={form.auth_header_name}
              onChange={(e) =>
                setForm((f) => ({ ...f, auth_header_name: e.target.value }))
              }
              placeholder="X-API-Key"
              className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 font-mono focus:border-ink-500 focus:outline-none"
            />
          </FieldLabel>
        )}
        {form.auth_type !== "none" && (
          <div className="sm:col-span-2">
            <FieldLabel
              label={
                initial?.has_auth_secret
                  ? t("settings.mcp.newSecret", {
                      defaultValue: "New secret (leave empty to keep existing)",
                    })
                  : t("settings.mcp.secret", { defaultValue: "Secret" })
              }
            >
              <input
                type="password"
                value={form.auth_secret}
                onChange={(e) =>
                  setForm((f) => ({ ...f, auth_secret: e.target.value }))
                }
                autoComplete="new-password"
                placeholder={initial?.has_auth_secret ? "•••••••• (already set)" : ""}
                className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 font-mono focus:border-ink-500 focus:outline-none"
              />
            </FieldLabel>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="h-3.5 w-3.5"
            />
            {t("settings.mcp.active", { defaultValue: "Active — tools are usable" })}
          </label>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !form.name || !form.url}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {mode === "create" ? t("settings.mcp.create", { defaultValue: "Add" }) : t("common.save")}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Image templates — house-style markdown prompts prepended to every
 * image generation (post covers, podcast covers, path covers).
 * -------------------------------------------------------------------- */
function ImageTemplatesTab() {
  const { t } = useTranslation();
  const { confirm } = useDialog();
  const [rows, setRows] = useState<ImageTemplateOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      setRows(await api.listImageTemplates());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const toggleDefault = async (row: ImageTemplateOut) => {
    try {
      const updated = await api.updateImageTemplate(row.id, {
        is_default: !row.is_default,
      });
      if (updated.is_default) {
        await refresh();
      } else {
        setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDelete = async (row: ImageTemplateOut) => {
    const ok = await confirm({
      title: t("settings.imageTemplates.confirmDeleteTitle", {
        defaultValue: "Remove this template?",
      }),
      body:
        t("settings.imageTemplates.confirmDeleteBody", {
          name: row.name,
          defaultValue:
            'The template "{{name}}" will be removed. Image generations that referenced it will fall back to the next default (if any).',
        }) ?? "",
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteImageTemplate(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <section className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink-100">
            {t("settings.imageTemplates.heading", { defaultValue: "Image templates" })}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
            {t("settings.imageTemplates.body", {
              defaultValue:
                "Markdown blocks that are prepended to every image generation — post covers, podcast covers, path covers. Mark one as default to apply it everywhere automatically.",
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreating(true);
            setEditingId(null);
          }}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("settings.imageTemplates.add", { defaultValue: "New template" })}
        </button>
      </header>

      {error && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>
      )}

      {creating && (
        <ImageTemplateForm
          mode="create"
          onSubmit={async (body) => {
            try {
              const created = await api.createImageTemplate(body as ImageTemplateCreate);
              if (created.is_default) await refresh();
              else setRows((prev) => [created, ...prev]);
              setCreating(false);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-xs text-ink-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("common.loading")}
        </p>
      ) : rows.length === 0 && !creating ? (
        <p className="rounded-lg border border-dashed border-ink-700 px-6 py-10 text-center text-sm text-ink-400">
          {t("settings.imageTemplates.empty", {
            defaultValue: 'No templates yet. Click "New template" to add your first one.',
          })}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              {editingId === row.id ? (
                <ImageTemplateForm
                  mode="edit"
                  initial={row}
                  onSubmit={async (body) => {
                    try {
                      const updated = await api.updateImageTemplate(row.id, body);
                      if (updated.is_default && !row.is_default) {
                        await refresh();
                      } else {
                        setRows((prev) =>
                          prev.map((r) => (r.id === row.id ? updated : r)),
                        );
                      }
                      setEditingId(null);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ImageTemplateRow
                  row={row}
                  onToggleDefault={() => void toggleDefault(row)}
                  onEdit={() => {
                    setEditingId(row.id);
                    setCreating(false);
                  }}
                  onDelete={() => void onDelete(row)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ImageTemplateRow({
  row,
  onToggleDefault,
  onEdit,
  onDelete,
}: {
  row: ImageTemplateOut;
  onToggleDefault: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const preview = row.content.slice(0, 220).replace(/\s+/g, " ").trim();
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-3.5 w-3.5 text-violet-300" />
            <p className="truncate text-sm font-semibold text-ink-100">{row.name}</p>
            {row.is_default && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-300 ring-1 ring-amber-500/30">
                <Star className="h-2.5 w-2.5 fill-current" />
                {t("settings.imageTemplates.default", { defaultValue: "default" })}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-[11px] text-ink-400">{preview}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggleDefault}
            title={
              row.is_default
                ? t("settings.imageTemplates.unsetDefault", {
                    defaultValue: "Unset default",
                  }) ?? ""
                : t("settings.imageTemplates.setDefault", {
                    defaultValue: "Set as default",
                  }) ?? ""
            }
            className={[
              "flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 transition",
              row.is_default
                ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                : "text-ink-300 hover:bg-ink-800",
            ].join(" ")}
          >
            <Star className={["h-3 w-3", row.is_default ? "fill-current" : ""].join(" ")} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800"
            title={t("common.edit", { defaultValue: "Edit" }) ?? "Edit"}
            aria-label={t("common.edit", { defaultValue: "Edit" }) ?? "Edit"}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-red-500/10 hover:text-red-300"
            title={t("common.delete") ?? ""}
            aria-label={t("common.delete") ?? "Delete"}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

const TEMPLATE_VAR_RE = /\{\{\s*([A-Z][A-Z0-9_]*)\s*\}\}/g;

function detectTemplateVars(text: string): string[] {
  const seen: string[] = [];
  for (const match of text.matchAll(TEMPLATE_VAR_RE)) {
    if (!seen.includes(match[1])) seen.push(match[1]);
  }
  return seen;
}

function ImageTemplateForm({
  mode,
  initial,
  onSubmit,
  onCancel,
}: {
  mode: "create" | "edit";
  initial?: ImageTemplateOut;
  onSubmit: (body: ImageTemplateCreate | ImageTemplateUpdate) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [knownVars, setKnownVars] = useState<ImageTemplateVariable[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImageTemplatePreview | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api
      .listImageTemplateVariables()
      .then((res) => setKnownVars(res.variables))
      .catch(() => setKnownVars([]));
  }, []);

  // Height-only auto-grow so the outer pane handles all scrolling.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  const detected = useMemo(() => detectTemplateVars(content), [content]);
  const knownNames = useMemo(() => new Set(knownVars.map((v) => v.name)), [knownVars]);

  const insertVar = (varName: string) => {
    const el = textareaRef.current;
    const snippet = `{{${varName}}}`;
    if (!el) {
      setContent((c) => c + snippet);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = content.slice(0, start) + snippet + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + snippet.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const result = await api.previewImageTemplate({ content });
      setPreview(result);
    } catch {
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const body: ImageTemplateCreate | ImageTemplateUpdate = {
        name: name.trim(),
        content,
        is_default: isDefault,
      };
      await onSubmit(body);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-4">
      <h4 className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-200">
        <ImageIcon className="h-3 w-3" />
        {mode === "create"
          ? t("settings.imageTemplates.formCreate", { defaultValue: "New image template" })
          : t("settings.imageTemplates.formEdit", { defaultValue: "Edit image template" })}
      </h4>
      <FieldLabel label={t("settings.imageTemplates.name", { defaultValue: "Name" })}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sci-fi Tech (LinkedIn)"
          className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
        />
      </FieldLabel>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_15rem]">
        <FieldLabel
          label={t("settings.imageTemplates.content", {
            defaultValue: "Markdown prompt template",
          })}
        >
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            placeholder="# Look-and-Feel …"
            className="block w-full resize-none overflow-hidden whitespace-pre-wrap break-words rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 font-mono text-[12px] leading-relaxed text-ink-100 focus:border-ink-500 focus:outline-none min-h-[20rem]"
          />
        </FieldLabel>

        <div className="rounded-md border border-ink-700 bg-ink-900/30 p-2.5">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
            {t("settings.imageTemplates.varsPaletteTitle", {
              defaultValue: "Click to insert",
            })}
          </div>
          <ul className="space-y-1.5">
            {knownVars.map((v) => {
              const used = detected.includes(v.name);
              return (
                <li key={v.name}>
                  <button
                    type="button"
                    onClick={() => insertVar(v.name)}
                    className={[
                      "block w-full rounded-md border px-2 py-1.5 text-left transition",
                      used
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-ink-700 bg-ink-800/40 text-ink-200 hover:border-ink-500 hover:bg-ink-800",
                    ].join(" ")}
                    title={v.description}
                  >
                    <code className="block font-mono text-[11px] font-semibold">{`{{${v.name}}}`}</code>
                    <span className="mt-0.5 block text-[10px] leading-tight text-ink-400">
                      {v.description}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {detected.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-ink-400">
            {t("settings.imageTemplates.detected", { defaultValue: "Detected" })}:
          </span>
          {detected.map((v) => {
            const known = knownNames.has(v);
            return (
              <span
                key={v}
                className={[
                  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px]",
                  known
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-500/50 bg-amber-500/10 text-amber-200",
                ].join(" ")}
                title={
                  known
                    ? t("settings.imageTemplates.detectedKnown", {
                        defaultValue: "Recognised variable — will be filled.",
                      }) ?? ""
                    : t("settings.imageTemplates.detectedUnknown", {
                        defaultValue:
                          "Unknown variable — the extractor has no rule for this name.",
                      }) ?? ""
                }
              >
                {known ? <Check className="h-2.5 w-2.5" /> : <span>!</span>}
                {`{{${v}}}`}
              </span>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void runPreview()}
          disabled={previewing || !content.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 px-2 py-1 text-[11px] text-ink-200 transition hover:bg-ink-800 disabled:opacity-50"
        >
          {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {t("settings.imageTemplates.previewBtn", {
            defaultValue: "Preview with last card",
          })}
        </button>
      </div>

      {preview && (
        <div className="mt-2 rounded-md border border-ink-700 bg-ink-900/30 p-2.5 text-[11px]">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="text-ink-300">
              {preview.card_title ? (
                <>
                  {t("settings.imageTemplates.previewFrom", {
                    defaultValue: "Grounded in",
                  })}
                  : <span className="font-medium text-ink-100">{preview.card_title}</span>
                </>
              ) : (
                t("settings.imageTemplates.previewNoCard", {
                  defaultValue: "No completed card found — used demo content.",
                })
              )}
            </div>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="text-ink-500 transition hover:text-ink-200"
              aria-label={t("common.close") ?? "Close"}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {Object.keys(preview.extracted).length > 0 && (
            <ul className="mb-2 space-y-0.5">
              {Object.entries(preview.extracted).map(([k, v]) => (
                <li key={k} className="flex items-baseline gap-2">
                  <code className="font-mono text-[10px] text-ink-400">{k}</code>
                  <span className="font-medium text-ink-100">{v || "—"}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="text-[10px] uppercase tracking-wide text-ink-400">
            {t("settings.imageTemplates.previewResolved", {
              defaultValue: "Resolved prompt sent to the image model",
            })}
          </div>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-ink-900/60 p-2 font-mono text-[10px] leading-snug text-ink-200">
            {preview.resolved}
          </pre>
        </div>
      )}

      <label className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-ink-300">
        <input
          type="checkbox"
          checked={isDefault}
          onChange={(e) => setIsDefault(e.target.checked)}
          className="h-3.5 w-3.5"
        />
        <Star className={["h-3 w-3", isDefault ? "text-amber-300 fill-current" : "text-ink-500"].join(" ")} />
        {t("settings.imageTemplates.defaultToggle", {
          defaultValue:
            "Make default — applied automatically to every image generation",
        })}
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !content.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {mode === "create" ? t("settings.imageTemplates.create", { defaultValue: "Add" }) : t("common.save")}
        </button>
      </div>
    </div>
  );
}
