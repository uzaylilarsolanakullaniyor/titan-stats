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
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import urllib.request
from urllib.parse import urljoin

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
# Titan'in mevcut PreStocks gecmisi. Her calismada sonraki epoch'lar taranir;
# yeni epoch acildiginda bu listeye elle mudahale gerekmez.
KNOWN_PRESTOCK_EPOCHS = [1, 2, 3, 4]
MAX_PRESTOCK_EPOCHS = 24

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


def get_text(path):
    req = urllib.request.Request(urljoin(BASE, path), headers=HEADERS, method="GET")
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "ignore")


def fetch_prestock_tokens():
    """Titan'in guncel token-listesi endpoint'inden PreStocks tokenlarini al."""
    payload = get("/api/tokens/lists?include=prestocks")
    prestocks = payload.get("lists", {}).get("prestocks", {})
    tokens = prestocks.get("results", []) if prestocks.get("success") else []
    if not isinstance(tokens, list) or not tokens:
        raise RuntimeError("PreStocks token listesi bos veya gecersiz")
    return tokens


def discover_prestock_epochs(tokens):
    """Titan'in acmis oldugu bitisik PreStocks epoch'larini algila."""
    epochs = list(KNOWN_PRESTOCK_EPOCHS)
    sample = next((token for token in tokens if token.get("address")), None)
    if not sample:
        return epochs

    for epoch in range(epochs[-1] + 1, MAX_PRESTOCK_EPOCHS + 1):
        try:
            payload = post("/api/wallet-stats/prestock-leaderboard", {
                "epoch": epoch,
                "wallet_address": "",
                "limit": 1,
                "campaign": CAMPAIGN,
                "token_contract_address": sample["address"],
            })
        except Exception:
            break
        # Henuz acilmamis epoch'lar hata doner. Gecerli ama bos epoch'lar ise
        # success ve dogru epoch degerini donmeye devam eder.
        if not payload.get("success") or int(payload.get("epoch") or 0) != epoch:
            break
        epochs.append(epoch)
    return epochs


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


def parse_js_number(value):
    """Minify edilmis JS sayisini (hex/scientific/production ternary) Python int'e cevir."""
    value = (value or "").strip()
    if "?" in value and ":" in value:
        value = value.rsplit(":", 1)[-1].strip()
    match = re.match(r"(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)", value, re.I)
    if not match:
        return 0
    token = match.group(0)
    return int(token, 16) if token.lower().startswith("0x") else int(float(token))


def parse_rewards_campaign_bundle(source):
    """Titan /rewards paketindeki ALL_CAMPAIGNS nesnelerini ayikla."""
    epoch_pattern = re.compile(
        r'\{id:(?P<id>\d+),label:"[^"]*",startTime:(?P<start>.*?),endTime:(?P<end>[^}]+)\}'
    )

    def campaign_objects():
        marker = re.compile(r'\{id:\d+,slug:"[^"]+",name:"[^"]+"')
        for found in marker.finditer(source):
            start = found.start()
            depth = 0
            quote = None
            escaped = False
            for index in range(start, len(source)):
                char = source[index]
                if quote:
                    if escaped:
                        escaped = False
                    elif char == "\\":
                        escaped = True
                    elif char == quote:
                        quote = None
                    continue
                if char in ('"', "'"):
                    quote = char
                elif char == "{":
                    depth += 1
                elif char == "}":
                    depth -= 1
                    if depth == 0:
                        yield source[start:index + 1]
                        break

    def text_field(block, name):
        found = re.search(rf'{name}:"((?:\\.|[^"])*)"', block)
        return found.group(1) if found else ""

    def number_field(block, name):
        found = re.search(rf'{name}:([^,}}]+)', block)
        return parse_js_number(found.group(1)) if found else 0

    campaigns = []
    for block in campaign_objects():
        slug = text_field(block, "slug")
        name = text_field(block, "name")
        if not slug or not name:
            continue
        start_match = re.search(r'startTime:(.*?),endTime:', block)
        end_match = re.search(r'endTime:([^,}]+)', block)
        start = parse_js_number(start_match.group(1)) if start_match else 0
        end = parse_js_number(end_match.group(1)) if end_match else 0
        epoch_ranges = {}
        epochs_match = re.search(r'epochs:\[(.*?)\](?:,tokenAddress|,rewardTokenAddress|})', block, re.S)
        if epochs_match:
            for epoch in epoch_pattern.finditer(epochs_match.group(1)):
                epoch_ranges[str(epoch.group("id"))] = {
                    "startTime": parse_js_number(epoch.group("start")),
                    "endTime": parse_js_number(epoch.group("end")),
                }
        epoch_ranges["all"] = {"startTime": start, "endTime": end}
        campaigns.append({
            "slug": slug,
            "name": name,
            "logo": urljoin(BASE, text_field(block, "logoUrl")),
            "description": bytes(text_field(block, "description"), "utf-8").decode("unicode_escape"),
            "startTime": start,
            "endTime": end,
            "totalEpoch": number_field(block, "totalEpoch"),
            "totalRewards": number_field(block, "totalRewards"),
            "epochRewards": number_field(block, "epochRewards"),
            "epochRanges": epoch_ranges,
            "tokenAddress": text_field(block, "tokenAddress"),
        })
    return campaigns


def discover_rewards_page_campaigns():
    """Rewards sayfasinin kullandigi resmi ALL_CAMPAIGNS yapilandirmasini oku."""
    page = get_text("/rewards")
    scripts = sorted(set(
        path for path in re.findall(r'(?:src|href)="([^"]+)"', page)
        if ".js" in path
    ))
    if not scripts:
        return []

    def fetch_script(path):
        try:
            return get_text(path)
        except Exception:
            return ""

    with ThreadPoolExecutor(max_workers=10) as pool:
        for source in pool.map(fetch_script, scripts):
            if "ALL_CAMPAIGNS" not in source or "SLUG_BASED_CAMPAIGNS" not in source:
                continue
            campaigns = parse_rewards_campaign_bundle(source)
            if campaigns:
                return campaigns
    return []


def discover_campaigns():
    """Titan Rewards yapilandirmasi ve aktif duyurulardan kampanyalari kesfet."""
    campaigns = deepcopy(FALLBACK_SINGLE_CAMPAIGNS)
    campaigns.update(load_saved_campaigns())
    seen_at = int(time.time())

    try:
        rewards_campaigns = discover_rewards_page_campaigns()
    except Exception as exc:
        print(f"  ! rewards kampanya listesi okunamadi: {exc}")
        rewards_campaigns = []
    rewards_slugs = {item.get("slug") for item in rewards_campaigns if item.get("slug")}

    try:
        response = post("/api/campaigns/get", {
            "wallet_address": "",
            "user_triggers": {"connected": False, "is_vip": False,
                              "not_vip": False, "no_sponsored_tx": False},
        })
        announcements = []
        for key in ("banner_campaigns", "toast_campaigns", "modal_campaigns"):
            announcements.extend(response.get(key, []) or [])
    except Exception as exc:
        print(f"  ! banner kampanya kesfi kullanilamadi: {exc}")
        announcements = []

    addresses = list(dict.fromkeys(
        [item.get("tokenAddress") for item in rewards_campaigns if item.get("tokenAddress")] +
        [item.get("output_mint") for item in announcements if item.get("output_mint")]
    ))
    try:
        token_rows = post("/api/tokens/multiple", {"addresses": addresses}).get("results", []) if addresses else []
        tokens = {token.get("address"): token for token in token_rows}
    except Exception as exc:
        print(f"  ! kampanya token bilgileri alinamadi: {exc}")
        tokens = {}

    def upsert(slug, raw_name, symbol, start, end, epoch_count, total_reward,
               epoch_reward=0, epoch_ranges=None, token_address="", logo=""):
        existing = campaigns.get(slug, {})
        previous_meta = existing.get("meta", {})
        epoch_count = max(1, min(12, int(epoch_count or 1)))
        epochs = [None] + list(range(1, epoch_count + 1))
        epoch_ranges = deepcopy(epoch_ranges or previous_meta.get("epochRanges", {}))
        if start and end:
            epoch_ranges.setdefault("all", {"startTime": start, "endTime": end})
            epoch_span = (end - start) / epoch_count
            for epoch_number in range(1, epoch_count + 1):
                epoch_start = round(start + (epoch_number - 1) * epoch_span)
                epoch_ranges.setdefault(str(epoch_number), {
                    "startTime": epoch_start,
                    "endTime": end if epoch_number == epoch_count else round(start + epoch_number * epoch_span),
                })
        label_name = re.sub(r"\s+campaign\s*$", "", raw_name or "", flags=re.I).strip()
        label_name = label_name or symbol or slug.replace("-", " ").title()
        derived_label = f"{label_name} · {symbol}" if symbol else label_name
        campaigns[slug] = {
            "epochs": epochs,
            "meta": {
                **previous_meta,
                "label": previous_meta.get("label") or derived_label,
                "symbol": symbol or previous_meta.get("symbol") or slug.upper(),
                "epochs": ["all"] + [str(i) for i in range(1, epoch_count + 1)],
                "campaignPool": total_reward or previous_meta.get("campaignPool", 0),
                "epochPool": epoch_reward or (
                    total_reward / epoch_count if total_reward else previous_meta.get("epochPool", 0)
                ),
                "topN": previous_meta.get("topN", 100),
                "costRate": previous_meta.get("costRate", 0.0003),
                "startTime": start or previous_meta.get("startTime", 0),
                "endTime": end or previous_meta.get("endTime", 0),
                "lastSeenAt": seen_at,
                "epochRanges": epoch_ranges,
                "tokenAddress": token_address or previous_meta.get("tokenAddress", ""),
                "logo": logo or previous_meta.get("logo", ""),
            },
        }
        action = "kampanya guncellendi" if existing else "yeni kampanya kesfedildi"
        print(f"  + {action}: {slug} ({campaigns[slug]['meta']['label']})")

    # Rewards sayfasindaki ALL_CAMPAIGNS, banner endpoint'inde bulunmayan
    # Solstice ve RoboStrategy gibi canli kampanyalari da icerir.
    for item in rewards_campaigns:
        slug = item.get("slug") or ""
        token_address = item.get("tokenAddress") or ""
        if not slug or (not token_address and slug not in campaigns):
            continue
        token = tokens.get(token_address, {})
        description = item.get("description") or ""
        symbol_match = re.search(r"\$([A-Z][A-Z0-9]*)", description)
        previous_symbol = campaigns.get(slug, {}).get("meta", {}).get("symbol", "")
        symbol = token.get("symbol") or previous_symbol or (symbol_match.group(1) if symbol_match else "")
        upsert(
            slug=slug,
            raw_name=item.get("name") or "",
            symbol=symbol,
            start=int(item.get("startTime") or 0),
            end=int(item.get("endTime") or 0),
            epoch_count=int(item.get("totalEpoch") or 1),
            total_reward=float(item.get("totalRewards") or 0),
            epoch_reward=float(item.get("epochRewards") or 0),
            epoch_ranges=item.get("epochRanges") or {},
            token_address=token_address,
            logo=token.get("logoURI") or item.get("logo") or "",
        )

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
        existing = campaigns.get(slug, {})
        # Rewards sayfasi kampanya tarihleri icin asil kaynaktir. Banner ayni
        # kampanyayi daha kisa bir promosyon penceresiyle gosterebilir.
        if slug in rewards_slugs:
            start = int(existing.get("meta", {}).get("startTime") or start)
            end = int(existing.get("meta", {}).get("endTime") or end)
        duration = max(0, end - start)
        existing_epochs = existing.get("epochs", [])
        epoch_count = (
            max(1, min(12, math.ceil(duration / (7 * 24 * 60 * 60))))
            if duration else max(1, len([ep for ep in existing_epochs if ep is not None]))
        )
        total_reward = parse_reward_amount((item.get("title") or "") + " " + (item.get("description") or ""))
        upsert(
            slug=slug,
            raw_name=raw_name,
            symbol=symbol,
            start=start,
            end=end,
            epoch_count=epoch_count,
            total_reward=total_reward,
            token_address=item.get("output_mint") or "",
            logo=token.get("logoURI") or item.get("image") or "",
        )
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
    tokens = fetch_prestock_tokens()
    print(f"{len(tokens)} token bulundu.")
    data = {}
    prestock_epochs = [None, *discover_prestock_epochs(tokens)]
    print("  epoch'lar: " + ", ".join(str(epoch) for epoch in prestock_epochs if epoch is not None))
    for ep in prestock_epochs:
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
