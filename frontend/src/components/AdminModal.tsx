import {
  Check,
  HardDrive,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Search as SearchIcon,
  Shield,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAdminModal } from "../lib/AdminModalContext";
import { useAuth } from "../lib/AuthContext";
import { useDialog } from "../lib/DialogContext";
import {
  api,
  type AdminUserCreate,
  type AdminUserRow,
  type AdminUserUpdate,
} from "../lib/api";

/**
 * Admin dashboard for managing users — shaped like SettingsModal so the
 * two admin-facing surfaces feel like the same family. List of every
 * user with stats, inline edit for each row, inline create form,
 * destructive delete with confirmation (cascades to all of the user's
 * cards, files, podcasts, paths, etc.).
 */
export default function AdminModal() {
  const { open, closeModal } = useAdminModal();
  const { t } = useTranslation();
  const { user: me } = useAuth();
  const { confirm } = useDialog();

  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Lock body scroll when open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeModal]);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await api.listAdminUsers();
      setRows(list);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (!open) return;
    void refresh();
    setQuery("");
    setEditingId(null);
    setCreating(false);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        (r.display_name || "").toLowerCase().includes(q) ||
        (r.username || "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const totalStorage = useMemo(
    () => rows.reduce((acc, r) => acc + (r.storage_bytes || 0), 0),
    [rows],
  );
  const totalCards = useMemo(
    () => rows.reduce((acc, r) => acc + (r.card_count || 0), 0),
    [rows],
  );

  const onRowCreated = (created: AdminUserRow) => {
    setRows((prev) => [created, ...prev]);
    setCreating(false);
  };

  const onRowUpdated = (updated: AdminUserRow) => {
    setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setEditingId(null);
  };

  const onDelete = async (row: AdminUserRow) => {
    const ok = await confirm({
      title: t("admin.confirmDeleteTitle", { defaultValue: "Delete user?" }),
      body: t("admin.confirmDeleteBody", {
        email: row.email,
        defaultValue:
          "{{email}} and ALL their content (cards, podcasts, paths, files, tags) will be deleted permanently. This cannot be undone.",
      }) ?? "",
      confirmLabel: t("common.delete") ?? "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteAdminUser(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={closeModal}
        aria-label={t("common.close", { defaultValue: "Close" }) ?? "Close"}
        className="absolute inset-0 bg-ink-900/70 backdrop-blur-sm modal-backdrop-enter"
      />

      <div className="relative z-10 m-auto flex h-full w-full max-h-none max-w-none flex-col overflow-hidden border-0 bg-ink-800 surface-elevated modal-card-enter sm:h-[640px] sm:w-[1100px] sm:max-h-[88vh] sm:max-w-[96vw] sm:rounded-2xl sm:border sm:border-ink-700">
        {/* Header */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-ink-700 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/15 ring-1 ring-rose-500/30">
              <Shield className="h-4 w-4 text-rose-300" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink-100">
                {t("admin.title", { defaultValue: "Admin · User management" })}
              </h2>
              <p className="text-[11px] text-ink-500">
                {rows.length}{" "}
                {t("admin.usersLabel", {
                  count: rows.length,
                  defaultValue: "users",
                })}{" "}
                · {totalCards}{" "}
                {t("admin.cardsLabel", {
                  count: totalCards,
                  defaultValue: "cards",
                })}{" "}
                · {formatBytes(totalStorage)} {t("admin.storageLabel", { defaultValue: "storage" })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label={t("common.close", { defaultValue: "Close" }) ?? "Close"}
            className="flex h-9 w-9 items-center justify-center rounded-md text-ink-300 transition active:bg-ink-700 hover:bg-ink-700 hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Toolbar */}
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-ink-700 px-5 py-2.5">
          <div className="relative flex-1 max-w-md">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                t("admin.searchPlaceholder", {
                  defaultValue: "Search by email, name or username…",
                }) ?? ""
              }
              className="w-full rounded-md border border-ink-700 bg-ink-900/40 py-1.5 pl-9 pr-3 text-sm text-ink-100 placeholder:text-ink-500 focus:border-ink-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setEditingId(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t("admin.newUser", { defaultValue: "New user" })}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <p className="mx-5 mt-3 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {creating && (
            <div className="border-b border-ink-800 bg-ink-900/40 px-5 py-4">
              <CreateForm
                onCreated={onRowCreated}
                onCancel={() => setCreating(false)}
                onError={setError}
              />
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 px-5 py-6 text-xs text-ink-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("common.loading")}
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-ink-400">
              {t("admin.noMatch", { defaultValue: "No users match." })}
            </p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {filtered.map((row) => (
                <li key={row.id}>
                  {editingId === row.id ? (
                    <div className="bg-ink-900/40 px-5 py-4">
                      <EditForm
                        row={row}
                        onUpdated={onRowUpdated}
                        onCancel={() => setEditingId(null)}
                        onError={setError}
                        isSelf={row.id === me?.id}
                      />
                    </div>
                  ) : (
                    <UserRow
                      row={row}
                      isSelf={row.id === me?.id}
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
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Single user row — read-only display + Edit / Delete actions.
 * -------------------------------------------------------------------- */
function UserRow({
  row,
  isSelf,
  onEdit,
  onDelete,
}: {
  row: AdminUserRow;
  isSelf: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-4 px-5 py-3 transition hover:bg-ink-900/30">
      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ink-100 to-ink-300 text-xs font-bold text-ink-900">
        {(row.display_name || row.email || "?")[0]?.toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink-100">
            {row.display_name || row.email}
          </p>
          {row.is_admin && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-rose-300 ring-1 ring-rose-500/30">
              <Shield className="h-2.5 w-2.5" />
              Admin
            </span>
          )}
          {row.public_profile && row.username && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
              @{row.username}
            </span>
          )}
          {isSelf && (
            <span className="inline-flex flex-shrink-0 items-center rounded-full bg-ink-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-300">
              {t("admin.you", { defaultValue: "you" })}
            </span>
          )}
        </div>
        <p className="truncate text-[11px] text-ink-400">{row.email}</p>
        <p className="mt-0.5 flex items-center gap-2.5 text-[10px] text-ink-500">
          <span className="inline-flex items-center gap-1">
            <Layers className="h-2.5 w-2.5" />
            {row.card_count} {t("library.stats.cards")}
          </span>
          <span className="inline-flex items-center gap-1">
            <HardDrive className="h-2.5 w-2.5" />
            {formatBytes(row.storage_bytes)}
          </span>
          <span>{new Date(row.created_at).toLocaleDateString()}</span>
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
          title={t("common.edit", { defaultValue: "Edit" }) ?? "Edit"}
          aria-label={t("common.edit", { defaultValue: "Edit" }) ?? "Edit"}
        >
          <Pencil className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={isSelf}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 text-ink-300 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30 disabled:hover:bg-ink-800"
          title={
            isSelf
              ? t("admin.cantDeleteSelf", { defaultValue: "Can't delete your own account" }) ?? ""
              : t("common.delete") ?? "Delete"
          }
          aria-label={t("common.delete") ?? "Delete"}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Inline create form.
 * -------------------------------------------------------------------- */
function CreateForm({
  onCreated,
  onCancel,
  onError,
}: {
  onCreated: (row: AdminUserRow) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AdminUserCreate>({
    email: "",
    password: "",
    display_name: "",
    is_admin: false,
    public_profile: false,
  });

  const submit = async () => {
    if (!form.email || !form.password || form.password.length < 8) {
      onError(
        t("admin.validation", {
          defaultValue: "Email + password (≥ 8 chars) required.",
        }) ?? "Email + password required.",
      );
      return;
    }
    setBusy(true);
    try {
      const created = await api.createAdminUser({
        ...form,
        display_name: (form.display_name || "").trim() || null,
      });
      onCreated(created);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-3">
      <h3 className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-200">
        <Plus className="h-3 w-3" />
        {t("admin.createTitle", { defaultValue: "Create user" })}
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("admin.email", { defaultValue: "Email" })}>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
            autoComplete="off"
          />
        </Field>
        <Field label={t("admin.displayName", { defaultValue: "Display name" })}>
          <input
            type="text"
            value={form.display_name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
          />
        </Field>
        <Field label={t("admin.password", { defaultValue: "Password (≥ 8)" })}>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
            autoComplete="new-password"
          />
        </Field>
        <div className="flex items-end gap-2 pb-1.5">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={form.is_admin ?? false}
              onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
              className="h-3.5 w-3.5"
            />
            <Shield className="h-3 w-3 text-rose-300" />
            {t("admin.flagAdmin", { defaultValue: "Admin" })}
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={form.public_profile ?? false}
              onChange={(e) => setForm((f) => ({ ...f, public_profile: e.target.checked }))}
              className="h-3.5 w-3.5"
            />
            {t("admin.flagPublic", { defaultValue: "Public profile" })}
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
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          {t("admin.createButton", { defaultValue: "Create" })}
        </button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
 * Inline edit form.
 * -------------------------------------------------------------------- */
function EditForm({
  row,
  onUpdated,
  onCancel,
  onError,
  isSelf,
}: {
  row: AdminUserRow;
  onUpdated: (row: AdminUserRow) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
  isSelf: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AdminUserUpdate>({
    email: row.email,
    display_name: row.display_name,
    is_admin: row.is_admin,
    public_profile: row.public_profile,
    password: "",
  });

  const submit = async () => {
    setBusy(true);
    const patch: AdminUserUpdate = {};
    if (form.email !== row.email) patch.email = form.email;
    if ((form.display_name || null) !== row.display_name)
      patch.display_name = form.display_name?.trim() || null;
    if (form.is_admin !== row.is_admin) patch.is_admin = form.is_admin;
    if (form.public_profile !== row.public_profile)
      patch.public_profile = form.public_profile;
    if (form.password && form.password.length >= 8) patch.password = form.password;
    try {
      const updated = await api.updateAdminUser(row.id, patch);
      onUpdated(updated);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-ink-700 bg-ink-800/40 p-3">
      <h3 className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-200">
        <Pencil className="h-3 w-3" />
        {t("admin.editTitle", { defaultValue: "Edit user" })}
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t("admin.email", { defaultValue: "Email" })}>
          <input
            type="email"
            value={form.email ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
          />
        </Field>
        <Field label={t("admin.displayName", { defaultValue: "Display name" })}>
          <input
            type="text"
            value={form.display_name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 focus:border-ink-500 focus:outline-none"
          />
        </Field>
        <Field
          label={t("admin.newPassword", {
            defaultValue: "New password (leave empty to keep)",
          })}
        >
          <input
            type="password"
            value={form.password ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            placeholder="—"
            className="w-full rounded-md border border-ink-700 bg-ink-900/40 px-2 py-1.5 text-sm text-ink-100 placeholder:text-ink-600 focus:border-ink-500 focus:outline-none"
            autoComplete="new-password"
          />
        </Field>
        <div className="flex items-end gap-3 pb-1.5">
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={form.is_admin ?? false}
              onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
              disabled={isSelf}
              className="h-3.5 w-3.5"
            />
            <Shield className="h-3 w-3 text-rose-300" />
            {t("admin.flagAdmin", { defaultValue: "Admin" })}
            {isSelf && (
              <span className="text-[10px] text-ink-500">
                ({t("admin.cantStripSelf", { defaultValue: "ask another admin" })})
              </span>
            )}
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-300">
            <input
              type="checkbox"
              checked={form.public_profile ?? false}
              onChange={(e) => setForm((f) => ({ ...f, public_profile: e.target.checked }))}
              className="h-3.5 w-3.5"
            />
            {t("admin.flagPublic", { defaultValue: "Public profile" })}
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
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-900 transition hover:bg-ink-200 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}
