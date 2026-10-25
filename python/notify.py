"""Slack Incoming Webhook 알림 (SLACK_WEBHOOK_URL 설정 시)."""

from __future__ import annotations

import logging

import httpx

from config import settings

logger = logging.getLogger(__name__)


def notify_slack(text: str, webhook_url: str | None = None) -> bool:
    url = webhook_url or settings.slack_webhook_url
    if not url:
        return False
    try:
        httpx.post(url, json={"text": text}, timeout=10.0).raise_for_status()
        return True
    except Exception:
        logger.exception("Slack notification failed")
        return False
