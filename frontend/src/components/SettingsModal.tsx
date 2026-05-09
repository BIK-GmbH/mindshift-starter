import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Github,
  Globe,
  Hash,
  HelpCircle,
  Languages,
  Loader2,
  Lock,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Puzzle,
  RefreshCw,
  SlidersHorizontal,
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
import { api, type TagWithCount } from "../lib/api";
import { getSoundsEnabled, playSound, setSoundsEnabled } from "../lib/sounds";

type SettingsTab = "account" | "appearance" | "tags" | "extension" | "about";

const tabs: { id: SettingsTab; labelKey: string; Icon: typeof UserRound }[] = [
  { id: "account", labelKey: "settings.tab.account", Icon: UserRound },
  { id: "appearance", labelKey: "settings.tab.appearance", Icon: SlidersHorizontal },
  { id: "tags", labelKey: "settings.tab.tags", Icon: Hash },
  { id: "extension", labelKey: "settings.tab.extension", Icon: Puzzle },
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
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

      {/* Modal */}
      <div className="relative flex h-[640px] max-h-[85vh] w-[920px] max-w-[92vw] overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 surface-elevated modal-card-enter">
        {/* Tabs sidebar */}
        <aside className="flex w-56 flex-shrink-0 flex-col border-r border-ink-700 bg-ink-900/40 p-3">
          <nav className="flex flex-1 flex-col gap-0.5" aria-label="settings sections">
            {tabs.map(({ id, labelKey, Icon }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={[
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                    isActive
                      ? "bg-ink-700/80 text-ink-100 ring-1 ring-ink-600"
                      : "text-ink-300 hover:bg-ink-700/40 hover:text-ink-100",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {t(labelKey)}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-ink-700 px-6 py-4">
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
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {active === "account" && <AccountTab />}
            {active === "appearance" && <AppearanceTab />}
            {active === "tags" && <TagsTab />}
            {active === "extension" && <ExtensionTab />}
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

        <div className="flex items-center justify-end gap-2">
          {user?.username && user?.public_profile && (
            <a
              href={`/u/${user.username}`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-ink-400 underline-offset-2 hover:text-ink-100 hover:underline"
            >
              /u/{user.username}
            </a>
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

function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const current = i18n.resolvedLanguage ?? "en";
  const [soundsOn, setSoundsOn] = useState<boolean>(() => getSoundsEnabled());

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
