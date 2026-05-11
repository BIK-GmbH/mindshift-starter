"""GitHub repository ingestion.

Fetches a public repository's metadata + README via the GitHub REST API
(no clone needed) and resolves a thumbnail using GitHub's auto-generated
social preview at opengraph.githubassets.com.

Authentication is optional: with GITHUB_TOKEN we get 5000 req/h, without
it 60 req/h per IP — fine for development, production should set the env.
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field

import httpx

GITHUB_API = "https://api.github.com"

# README is capped — some repos ship multi-megabyte FAQs/RFCs that would
# otherwise blow past the summarizer budget.
_README_CHAR_BUDGET = 80_000

# Owner: 1–39 chars, alphanumeric and hyphens, can't start/end with hyphen.
# Repo: alphanumeric + . _ -. We accept an optional .git suffix and ignore
# anything past the second path segment (branches, files, …).
_REPO_PATTERN = re.compile(
    r"^(?:https?://)?(?:www\.)?github\.com/"
    r"([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?)/"
    r"([A-Za-z0-9._-]+?)"
    r"(?:\.git)?(?:/.*)?/?$",
    re.IGNORECASE,
)


@dataclass(slots=True)
class GithubRepo:
    owner: str
    repo: str
    full_name: str
    description: str | None
    homepage: str | None
    html_url: str
    default_branch: str
    language: str | None
    languages: dict[str, int] = field(default_factory=dict)
    topics: list[str] = field(default_factory=list)
    stars: int = 0
    forks: int = 0
    license_name: str | None = None
    readme_md: str | None = None
    thumbnail_url: str = ""
    canonical_url: str = ""


def parse_repo_url(url: str) -> tuple[str, str] | None:
    """Extract (owner, repo) from common GitHub URL forms.

    Accepts: github.com/o/r, https://github.com/o/r, …/o/r.git, …/o/r/tree/main,
    …/o/r/blob/main/path, with or without trailing slash.
    """
    if not url:
        return None
    m = _REPO_PATTERN.match(url.strip())
    if not m:
        return None
    owner, repo = m.group(1), m.group(2)
    if repo.endswith(".git"):
        repo = repo[:-4]
    # Filter out non-repo segments that match the pattern (e.g.
    # github.com/orgs, /settings, /sponsors).
    if owner.lower() in {"orgs", "settings", "sponsors", "topics", "marketplace", "features", "pricing"}:
        return None
    return owner, repo


def _client_headers() -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Mindshift/0.1 (+github-ingest)",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def fetch_repo(url: str) -> GithubRepo | None:
    """Fetch repo metadata, languages and README. Returns None on failure."""
    parsed = parse_repo_url(url)
    if not parsed:
        return None
    owner, repo = parsed
    full = f"{owner}/{repo}"

    try:
        with httpx.Client(
            timeout=20.0, headers=_client_headers(), follow_redirects=True
        ) as client:
            r = client.get(f"{GITHUB_API}/repos/{full}")
            if r.status_code in (404, 451):
                return None
            r.raise_for_status()
            data = r.json()

            # Languages — best-effort, don't fail the whole request.
            languages: dict[str, int] = {}
            try:
                lr = client.get(f"{GITHUB_API}/repos/{full}/languages")
                if lr.status_code == 200:
                    languages = lr.json()
            except httpx.HTTPError:
                pass

            # README — best-effort.
            readme_md: str | None = None
            try:
                rd = client.get(f"{GITHUB_API}/repos/{full}/readme")
                if rd.status_code == 200:
                    rd_data = rd.json()
                    if rd_data.get("encoding") == "base64" and rd_data.get("content"):
                        decoded = base64.b64decode(rd_data["content"]).decode(
                            "utf-8", errors="replace"
                        )
                        if len(decoded) > _README_CHAR_BUDGET:
                            decoded = decoded[:_README_CHAR_BUDGET] + "\n\n…(README truncated)"
                        readme_md = decoded
            except httpx.HTTPError:
                pass
    except (httpx.HTTPError, ValueError):
        return None

    # Thumbnail resolution — try the wide header image first, fall back
    # to the owner's avatar when we can't get one.
    #
    # The naive `opengraph.githubassets.com/1/<owner>/<repo>` URL is
    # rate-limited (100 req / 15 min per browser IP — kills a library
    # full of GH cards). The HASH-keyed URL it redirects to (e.g.
    # `opengraph.githubassets.com/<sha256>/<owner>/<repo>`) is aggressively
    # CDN-cached and effectively unthrottled. Same hostname, very
    # different infrastructure.
    #
    # The hash is generated server-side from the rendered card content.
    # We can grab it (and any custom social preview the maintainer
    # uploaded — those serve from `repository-images.githubusercontent.com`)
    # by scraping the repo's HTML page for its `<meta property="og:image">`
    # tag. One extra HTTP request per ingestion, no GitHub API quota
    # cost, no auth required.
    thumbnail = _resolve_og_image(full, client_headers=_client_headers())
    if not thumbnail:
        avatar = (data.get("owner") or {}).get("avatar_url") or ""
        thumbnail = avatar  # last-resort: owner avatar (CDN, square)

    return GithubRepo(
        owner=owner,
        repo=repo,
        full_name=full,
        description=data.get("description"),
        homepage=(data.get("homepage") or None),
        html_url=data.get("html_url") or f"https://github.com/{full}",
        default_branch=data.get("default_branch") or "main",
        language=data.get("language"),
        languages=languages,
        topics=list(data.get("topics") or []),
        stars=int(data.get("stargazers_count") or 0),
        forks=int(data.get("forks_count") or 0),
        license_name=(data.get("license") or {}).get("spdx_id"),
        readme_md=readme_md,
        thumbnail_url=thumbnail,
        canonical_url=f"https://github.com/{full}",
    )


_OG_RE = re.compile(
    r'<meta\s+property="og:image"\s+content="([^"]+)"', re.IGNORECASE
)


def _resolve_og_image(full_name: str, *, client_headers: dict) -> str:
    """Scrape the repo HTML once for its og:image meta tag.

    Returns the hash-keyed CDN URL on success. Rejects the simple
    `/1/<owner>/<repo>` form (which IS rate-limited even though the
    hash form isn't) and any non-image URL. Returns "" on failure so
    the caller can fall back to the owner avatar.
    """
    # Don't reuse _client_headers' Accept which prefers JSON.
    headers = dict(client_headers)
    headers["Accept"] = "text/html,application/xhtml+xml"
    headers.setdefault("User-Agent", "Mozilla/5.0 (compatible; Mindshift/0.1)")
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True, headers=headers) as client:
            resp = client.get(f"https://github.com/{full_name}")
            if resp.status_code != 200:
                return ""
            m = _OG_RE.search(resp.text)
            if not m:
                return ""
            url = m.group(1).strip()
    except (httpx.HTTPError, ValueError):
        return ""

    # Reject the rate-limited simple-form URL — only the long hash-keyed
    # variant is CDN-cached. /1/owner/repo would 429 just like before.
    if "/opengraph.githubassets.com/1/" in url:
        return ""
    # Sanity: only http(s) image URLs.
    if not url.startswith(("https://", "http://")):
        return ""

    # Pre-flight the URL with a GET so we (a) confirm the CDN actually
    # serves it (some cold hash URLs still 429 if the cache is empty)
    # and (b) warm the cache for the user's subsequent browser fetch.
    try:
        with httpx.Client(
            timeout=8.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Mindshift/0.1)"},
        ) as client:
            head = client.get(url)
            if head.status_code != 200:
                return ""
            ctype = (head.headers.get("content-type") or "").lower()
            if not ctype.startswith("image/"):
                return ""
    except httpx.HTTPError:
        return ""

    return url


def build_summary_block(repo: GithubRepo) -> str:
    """Combine metadata + README into a single text block for the summarizer."""
    lines: list[str] = [f"# {repo.full_name}"]
    if repo.description:
        lines += ["", repo.description]
    lines += ["", "## Repository facts"]
    lines.append(f"- Stars: {repo.stars}")
    lines.append(f"- Forks: {repo.forks}")
    lines.append(f"- Default branch: {repo.default_branch}")
    if repo.language:
        lines.append(f"- Primary language: {repo.language}")
    if repo.languages:
        # Top 6 languages by byte count.
        top = sorted(repo.languages.items(), key=lambda kv: kv[1], reverse=True)[:6]
        lines.append("- Languages: " + ", ".join(name for name, _ in top))
    if repo.topics:
        lines.append("- Topics: " + ", ".join(repo.topics))
    if repo.license_name:
        lines.append(f"- License: {repo.license_name}")
    if repo.homepage:
        lines.append(f"- Homepage: {repo.homepage}")
    lines += ["", "---", "", "## README", "", repo.readme_md or "_(no README found)_"]
    return "\n".join(lines)
