import { Hash } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { api, type TagWithCount } from "../lib/api";

export default function TagsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [tags, setTags] = useState<TagWithCount[]>([]);

  const activeTag = params.get("tag");

  useEffect(() => {
    let cancelled = false;
    void api.listTags().then((list) => {
      if (!cancelled) setTags(list);
    });
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (tags.length === 0) return null;

  const select = (name: string | null) => {
    const next = new URLSearchParams(params);
    if (name) next.set("tag", name);
    else next.delete("tag");
    navigate(`/${next.toString() ? `?${next.toString()}` : ""}`);
  };

  return (
    <div className="space-y-0.5 px-3">
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          {t("nav.tags")}
        </p>
        <span className="text-[10px] text-ink-500">{tags.length}</span>
      </div>
      <button
        type="button"
        onClick={() => select(null)}
        className={[
          "flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition",
          !activeTag
            ? "bg-ink-700/60 text-ink-100"
            : "text-ink-300 hover:bg-ink-700/30 hover:text-ink-100",
        ].join(" ")}
      >
        <span>{t("nav.allCards")}</span>
      </button>
      {tags.map((tag) => (
        <button
          key={tag.name}
          type="button"
          onClick={() => select(tag.name)}
          className={[
            "group flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition",
            activeTag === tag.name
              ? "bg-ink-700/60 text-ink-100"
              : "text-ink-300 hover:bg-ink-700/30 hover:text-ink-100",
          ].join(" ")}
        >
          <span className="flex items-center gap-1.5 truncate">
            <Hash
              className={[
                "h-3 w-3 flex-shrink-0",
                activeTag === tag.name ? "text-ink-100" : "text-ink-500 group-hover:text-ink-300",
              ].join(" ")}
            />
            <span className="truncate">{tag.name}</span>
          </span>
          <span
            className={[
              "ml-2 rounded-full px-1.5 text-[9px] font-medium tabular-nums transition",
              activeTag === tag.name
                ? "bg-ink-100/15 text-ink-100"
                : "bg-ink-800 text-ink-400 group-hover:bg-ink-700 group-hover:text-ink-200",
            ].join(" ")}
          >
            {tag.count}
          </span>
        </button>
      ))}
    </div>
  );
}
