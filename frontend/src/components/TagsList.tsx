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
    <div className="space-y-1 px-2">
      <p className="px-2 pb-1 text-[10px] uppercase tracking-wide text-ink-400">
        {t("nav.tags")}
      </p>
      <button
        type="button"
        onClick={() => select(null)}
        className={[
          "flex w-full items-center justify-between rounded-md px-3 py-1 text-xs",
          !activeTag ? "bg-ink-700 text-ink-100" : "text-ink-300 hover:bg-ink-700/60 hover:text-ink-100",
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
            "flex w-full items-center justify-between rounded-md px-3 py-1 text-xs",
            activeTag === tag.name
              ? "bg-ink-700 text-ink-100"
              : "text-ink-300 hover:bg-ink-700/60 hover:text-ink-100",
          ].join(" ")}
        >
          <span className="flex items-center gap-1.5 truncate">
            <Hash className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{tag.name}</span>
          </span>
          <span className="ml-2 text-[10px] text-ink-400">{tag.count}</span>
        </button>
      ))}
    </div>
  );
}
