import {
  ChevronRight,
  Github,
  Hash,
  HelpCircle,
  Languages,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Pencil,
  Plus,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../lib/AuthContext";
import { useSettingsModal } from "../lib/SettingsModalContext";
import { useTheme } from "../lib/ThemeContext";
import { api, type TagWithCount } from "../lib/api";

type SettingsTab = "account" | "appearance" | "tags" | "about";

const tabs: { id: SettingsTab; labelKey: string; Icon: typeof UserRound }[] = [
  { id: "account", labelKey: "settings.tab.account", Icon: UserRound },
  { id: "appearance", labelKey: "settings.tab.appearance", Icon: SlidersHorizontal },
  { id: "tags", labelKey: "settings.tab.tags", Icon: Hash },
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
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-md transition"
        aria-label="Close settings"
      />

      {/* Modal */}
      <div className="relative flex h-[640px] max-h-[85vh] w-[920px] max-w-[92vw] overflow-hidden rounded-2xl border border-ink-700 bg-ink-800 shadow-2xl">
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
            {active === "about" && <AboutTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountTab() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-ink-700 bg-ink-900/30 p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-ink-100 to-ink-300 text-ink-900">
            <UserRound className="h-5 w-5" />
          </div>
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
    </section>
  );
}

function AppearanceTab() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const current = i18n.resolvedLanguage ?? "en";

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
    const next = window.prompt(t("settings.tags.renamePrompt") ?? "Rename to:", tag.name);
    if (!next || next.trim() === tag.name) return;
    await api.updateTag(tag.id, { name: next.trim() });
    void refresh();
  };

  const onDelete = async (tag: TagWithCount) => {
    if (
      !window.confirm(
        (t("settings.tags.confirmDelete") ?? "Delete tag") + ` “${tag.name}”?`,
      )
    )
      return;
    await api.deleteTag(tag.id);
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
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-900 transition hover:bg-white disabled:opacity-50"
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
