"""키 없는 공개 웹 수집 공통 규칙: robots.txt 준수 · 요청 간격 · 정직한 User-Agent."""

from __future__ import annotations

import logging
import re
import time
from functools import lru_cache
from urllib.parse import unquote, urlparse

import httpx

logger = logging.getLogger(__name__)

USER_AGENT = "EventNowBot/1.0 (+https://eventnow.vercel.app; family event curation)"
# robots.txt 에서 우리를 가리키는 이름 (User-agent 줄과 비교)
BOT_TOKEN = "eventnowbot"

# 인증서 체인을 다 보내지 않는(중간 인증서 누락) 공공 사이트. 브라우저는 스스로 보완하지만
# httpx 는 거절한다. 공개 일정표를 읽기만 하고 아무것도 보내지 않으므로 이 주소들에 한해 검증을 끈다.
INSECURE_TLS_HOSTS = frozenset({"www.ui4u.go.kr"})


def tls_verify(url: str) -> bool:
    return urlparse(url).hostname not in INSECURE_TLS_HOSTS


class Robots:
    """robots.txt 판정 — 표준(RFC 9309) 방식.

    파이썬 기본 RobotFileParser 는 규칙을 '처음 맞는 것'으로 판정해
    'Disallow: /' 다음 'Allow: /culture/culture/' 처럼 허용 경로를 열어 둔 사이트를 모두 막는다.
    표준은 '가장 길게 맞는 규칙'이 이기고, 길이가 같으면 허용이 이긴다.
    """

    def __init__(self, text: str) -> None:
        groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
        agents: list[str] = []
        rules: list[tuple[bool, str]] = []
        last_was_agent = False
        for raw in text.splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (p.strip() for p in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if not last_was_agent and (agents or rules):
                    groups.append((agents, rules))
                    agents, rules = [], []
                agents.append(value.lower())
                last_was_agent = True
            elif key in ("allow", "disallow"):
                rules.append((key == "allow", value))
                last_was_agent = False
            else:
                last_was_agent = False
        if agents or rules:
            groups.append((agents, rules))
        # 우리 이름을 콕 집은 묶음 → 없으면 '*' 묶음
        mine = [r for a, r in groups if any(x != "*" and x in BOT_TOKEN for x in a)]
        star = [r for a, r in groups if "*" in a]
        chosen = mine or star
        self.rules = [rule for group in chosen for rule in group]

    @staticmethod
    def _pattern(path: str) -> re.Pattern[str]:
        anchored = path.endswith("$")
        body = re.escape(path[:-1] if anchored else path).replace(r"\*", ".*")
        return re.compile(body + ("$" if anchored else ""))

    def allowed(self, path: str) -> bool:
        best_len, best_allow = -1, True
        for allow, rule in self.rules:
            if rule == "":
                continue  # 빈 Disallow 는 '모두 허용'
            if self._pattern(rule).match(path):
                length = len(rule)
                if length > best_len or (length == best_len and allow):
                    best_len, best_allow = length, allow
        return best_allow


@lru_cache(maxsize=32)
def _robots_for(origin: str) -> Robots | None:
    try:
        resp = httpx.get(
            f"{origin}/robots.txt",
            headers={"User-Agent": USER_AGENT},
            timeout=15.0,
            follow_redirects=True,
            verify=tls_verify(origin),
        )
    except httpx.HTTPError:
        logger.warning("robots.txt unreachable for %s; treating as disallowed", origin)
        return None
    if resp.status_code >= 400:
        # robots.txt가 없으면 전체 허용이 관례
        return Robots("")
    # 일부 공공 사이트는 robots.txt 를 EUC-KR 로 준다 — 규칙 줄은 ASCII 라 깨진 글자만 무시하면 된다
    return Robots(resp.content.decode("utf-8", errors="replace"))


def robots_allowed(url: str) -> bool:
    parts = urlparse(url)
    robots = _robots_for(f"{parts.scheme}://{parts.netloc}")
    if robots is None:
        return False
    path = unquote(parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return robots.allowed(path)


class Throttle:
    """같은 호스트에 최소 간격을 두고 요청한다."""

    def __init__(self, min_interval: float = 1.0) -> None:
        self.min_interval = min_interval
        self._last = 0.0

    def wait(self) -> None:
        delay = self._last + self.min_interval - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self._last = time.monotonic()
