#!/usr/bin/env python3
"""
PreStocks hacim verisini titan.exchange'den ceker ve data.json olarak yazar.

Bu script GitHub Actions tarafindan zamanlanmis sekilde calistirilir
(ayrica elle de calistirabilirsin: python3 build_data.py).
Sunucu/baglanti gerektirmez; sadece Python standart kutuphanesi.

Cikti: data.json  ->  PreStocks epoch'lari + otomatik kesfedilen kampanyalar ve metadata
GitHub Pages'teki index.html acilirken bu dosyayi ceker.
"""

import json
import math
import os
import re
import time
import unicodedata
from copy import deepcopy
import urllib.request

BASE = "https://titan.exchange"
HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://titan.exchange",
    "Referer": "https://titan.exchange/prestock",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
}
CAMPAIGN = 4     # PreStocks kampanya id'si
LIMIT = 100      # API ust siniri
EPOCHS = [None, 1, 2, 3, 4]   # None = tum kampanya

# Titan duyurusu gecici olarak ulasilamazsa kullanilan bilinen kampanyalar.
# Yeni kampanyalar discover_campaigns() tarafindan otomatik eklenir.
FALLBACK_SINGLE_CAMPAIGNS = {
    "spacex": {
        "epochs": [None, 1, 2],
        "meta": {"label": "SpaceX · SPCX", "symbol": "SPCX", "epochs": ["all", "1", "2"],
                 "campaignPool": 10000, "epochPool": 5000, "topN": 100, "costRate": 0.0003},
    },
    "micron": {
        "epochs": [None, 1, 2],
        "meta": {"label": "Micron · MU", "symbol": "MU", "epochs": ["all", "1", "2"],
                 "campaignPool": 10000, "epochPool": 5000, "topN": 100, "costRate": 0.0003},
    },
    "robostrategy": {
        "epochs": [None, 1, 2],
        "meta": {"label": "RoboStrategy · BOT", "symbol": "BOT", "epochs": ["all", "1", "2"],
                 "campaignPool": 10000, "epochPool": 5000, "topN": 100, "costRate": 0.0003},
    },
    "solstice": {
        "epochs": [None, 1, 2, 3, 4],
        "meta": {"label": "Solstice · SLX", "symbol": "SLX", "epochs": ["all", "1", "2", "3", "4"],
                 "campaignPool": 30000, "epochPool": 7500, "topN": 100, "costRate": 0.0003},
    },
}


def post(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(), headers=HEADERS, method="POST"
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def get(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS, method="GET")
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.load(r)


def slugify(value):
    value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", value)


def parse_reward_amount(text):
    match = re.search(r"\$?([\d,]+(?:\.\d+)?)\s*USDC(?:\s+in)?\s+rewards", text or "", re.I)
    return float(match.group(1).replace(",", "")) if match else 0


def load_saved_campaigns():
    """Daha once otomatik kesfedilen kampanyalari duyuru bittikten sonra da koru."""
    if not os.path.exists("data.json"):
        return {}
    try:
        with open("data.json", encoding="utf-8") as source:
            saved = json.load(source)
    except (OSError, ValueError):
        return {}
    out = {}
    for slug, payload in saved.items():
        if not isinstance(payload, dict) or not isinstance(payload.get("meta"), dict):
            continue
        meta = payload["meta"]
        epochs = [None if str(ep) == "all" else int(ep) for ep in meta.get("epochs", [])]
        if epochs:
            out[slug] = {"epochs": epochs, "meta": meta}
    return out


def probe_campaign_slug(candidates):
    """Titan leaderboard'unda calisan ilk slug'i dondur."""
    for slug in dict.fromkeys(filter(None, candidates)):
        try:
            data = post("/api/wallet-stats/campaign-leaderboard", {
                "campaign_slug": slug, "epoch": None,
                "limit": 1, "wallet_address": "",
            })
            if isinstance(data.get("leaderboard"), list):
                return data.get("campaign_slug") or slug
        except Exception:
            pass
    return None


def discover_campaigns():
    """Titan'in aktif duyurularindan yeni hacim kampanyalarini otomatik kesfet."""
    campaigns = deepcopy(FALLBACK_SINGLE_CAMPAIGNS)
    campaigns.update(load_saved_campaigns())
    try:
        response = post("/api/campaigns/get", {
            "wallet_address": "",
            "user_triggers": {"connected": False, "is_vip": False,
                              "not_vip": False, "no_sponsored_tx": False},
        })
        announcements = []
        for key in ("banner_campaigns", "toast_campaigns", "modal_campaigns"):
            announcements.extend(response.get(key, []) or [])
        addresses = list(dict.fromkeys(a.get("output_mint") for a in announcements if a.get("output_mint")))
        token_rows = post("/api/tokens/multiple", {"addresses": addresses}).get("results", []) if addresses else []
        tokens = {t.get("address"): t for t in token_rows}
    except Exception as exc:
        print(f"  ! kampanya kesfi kullanilamadi, kayitli liste kullaniliyor: {exc}")
        return campaigns

    seen_ids = set()
    for item in announcements:
        campaign_id = item.get("campaign_id") or ""
        if not campaign_id or campaign_id in seen_ids or not item.get("output_mint"):
            continue
        seen_ids.add(campaign_id)
        token = tokens.get(item.get("output_mint"), {})
        raw_name = (token.get("name") or "").split(" - ")[0].strip()
        symbol_match = re.search(r"\$([A-Z][A-Z0-9]*)", (item.get("title") or "") + " " + (item.get("description") or ""))
        symbol = token.get("symbol") or (symbol_match.group(1) if symbol_match else "")
        id_base = re.sub(r"-(?:banner|toast|modal)(?:-.*)?$", "", campaign_id, flags=re.I)
        candidates = [
            slugify(raw_name),
            slugify(raw_name.split()[0] if raw_name else ""),
            slugify(id_base),
            slugify(symbol),
        ]
        known = next((candidate for candidate in candidates if candidate in campaigns), None)
        slug = known or probe_campaign_slug(candidates)
        if not slug:
            continue

        start = int(item.get("campaignStartDate") or 0)
        end = int(item.get("campaignEndDate") or 0)
        duration = max(0, end - start)
        existing = campaigns.get(slug, {})
        existing_epochs = existing.get("epochs", [])
        epoch_count = (
            max(1, min(12, math.ceil(duration / (7 * 24 * 60 * 60))))
            if duration else max(1, len([ep for ep in existing_epochs if ep is not None]))
        )
        total_reward = parse_reward_amount((item.get("title") or "") + " " + (item.get("description") or ""))
        epochs = [None] + list(range(1, epoch_count + 1))
        label_name = raw_name or symbol or slug.replace("-", " ").title()
        previous_meta = existing.get("meta", {})
        epoch_ranges = previous_meta.get("epochRanges", {})
        if start and end:
            week = 7 * 24 * 60 * 60
            epoch_ranges = {"all": {"startTime": start, "endTime": end}}
            for epoch_number in range(1, epoch_count + 1):
                epoch_start = start + (epoch_number - 1) * week
                epoch_ranges[str(epoch_number)] = {
                    "startTime": epoch_start,
                    "endTime": min(end, epoch_start + week),
                }
        campaigns[slug] = {
            "epochs": epochs,
            "meta": {
                **previous_meta,
                "label": (f"{label_name} · {symbol}" if symbol else label_name) or previous_meta.get("label"),
                "symbol": symbol or previous_meta.get("symbol") or slug.upper(),
                "epochs": ["all"] + [str(i) for i in range(1, epoch_count + 1)],
                "campaignPool": total_reward or previous_meta.get("campaignPool", 0),
                "epochPool": (total_reward / epoch_count) if total_reward else previous_meta.get("epochPool", 0),
                "topN": previous_meta.get("topN", 100),
                "costRate": previous_meta.get("costRate", 0.0003),
                "startTime": start or previous_meta.get("startTime", 0),
                "endTime": end or previous_meta.get("endTime", 0),
                "epochRanges": epoch_ranges,
                "tokenAddress": item.get("output_mint"),
                "logo": token.get("logoURI") or item.get("image") or previous_meta.get("logo"),
            },
        }
        action = "kampanya guncellendi" if existing else "yeni kampanya kesfedildi"
        print(f"  + {action}: {slug} ({campaigns[slug]['meta']['label']})")
    return campaigns


def build_epoch(epoch, tokens):
    vol_key = "user_campaign_volume_usd" if epoch is None else "user_epoch_volume_usd"
    trd_key = "user_campaign_trades" if epoch is None else "user_epoch_trades"
    out, grand_v, grand_t = [], 0.0, 0

    for t in tokens:
        body = {
            "epoch": epoch, "wallet_address": "", "limit": LIMIT,
            "campaign": CAMPAIGN, "token_contract_address": t["address"],
        }
        try:
            lb = post("/api/wallet-stats/prestock-leaderboard", body).get("leaderboard", []) or []
        except Exception as e:
            print(f"  ! {t['symbol']} (epoch={epoch}) hata: {e}")
            lb = []

        volume = sum(float(r.get(vol_key) or 0) for r in lb)
        trades = sum(int(r.get(trd_key) or 0) for r in lb)
        grand_v += volume
        grand_t += trades
        out.append({
            "symbol": t.get("symbol"), "name": t.get("name"),
            "logo": t.get("logoURI"), "address": t.get("address"),
            "volume": volume, "trades": trades, "traders": len(lb),
            "capped": len(lb) >= LIMIT,
            # Tam ilk-100 listesi (cuzdan siralamasi aramasi icin)
            "board": [{
                "rank": r.get("rank"),
                "name": r.get("username") or r.get("wallet_address") or "—",
                "volume": round(float(r.get(vol_key) or 0), 2),
                "vip": bool(r.get("is_vip")),
            } for r in lb],
        })

    out.sort(key=lambda x: x["volume"], reverse=True)
    return {
        "epoch": "all" if epoch is None else epoch,
        "limit": LIMIT, "campaign": CAMPAIGN, "tokens": out,
        "grandVolume": grand_v, "grandTrades": grand_t,
        "tokenCount": len(out), "generatedAt": int(time.time() * 1000),
    }


def build_campaign_epoch(slug, epoch):
    """Tek-token/tek-market kampanyalar — ayri endpoint, campaign_slug ile."""
    try:
        d = post("/api/wallet-stats/campaign-leaderboard", {
            "campaign_slug": slug, "epoch": epoch,
            "limit": LIMIT, "wallet_address": "",
        })
        lb = d.get("leaderboard", []) or []
    except Exception as e:
        print(f"  ! {slug} epoch={epoch} hata: {e}")
        lb = []
    vol_key = "user_campaign_volume_usd" if epoch is None else "user_epoch_volume_usd"
    trd_key = "user_campaign_trades" if epoch is None else "user_epoch_trades"
    return {
        "epoch": "all" if epoch is None else epoch,
        "volume": sum(float(r.get(vol_key) or 0) for r in lb),
        "trades": sum(int(r.get(trd_key) or 0) for r in lb),
        "traders": len(lb),
        "capped": len(lb) >= LIMIT,
        "board": [{
            "rank": r.get("rank"),
            "name": r.get("username") or r.get("wallet_address") or "—",
            "volume": round(float(r.get(vol_key) or 0), 2),
            "vip": bool(r.get("is_vip")),
        } for r in lb],
        "generatedAt": int(time.time() * 1000),
    }


def main():
    campaign_defs = discover_campaigns()
    tokens = get("/api/tokens/prestocks").get("results", [])
    print(f"{len(tokens)} token bulundu.")
    data = {}
    for ep in EPOCHS:
        key = "all" if ep is None else str(ep)
        data[key] = build_epoch(ep, tokens)
        print(f"  {key:>3}: ${round(data[key]['grandVolume']):,}")
    # Tek-token/tek-market kampanyalar (SpaceX, Micron, RoboStrategy, Solstice)
    for slug, config in campaign_defs.items():
        data[slug] = {"meta": config["meta"]}
        for ep in config["epochs"]:
            data[slug]["all" if ep is None else str(ep)] = build_campaign_epoch(slug, ep)
        print(f"  {slug}/all: ${round(data[slug]['all']['volume']):,}")
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("data.json yazildi.")


if __name__ == "__main__":
    main()
