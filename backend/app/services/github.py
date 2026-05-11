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

    # Prefer the owner's avatar (served from GitHub's CDN — no rate
    # limiting, square, small) over opengraph.githubassets.com's auto-
    # generated social preview. The OG endpoint is throttled to 100
    # requests / 15 minutes per browser IP and starts returning 429
    # as soon as a library page renders a handful of GH cards at once.
    avatar = (data.get("owner") or {}).get("avatar_url") or ""
    thumbnail = avatar or f"https://opengraph.githubassets.com/1/{full}"

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
