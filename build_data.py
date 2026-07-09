#!/usr/bin/env python3
"""
PreStocks hacim verisini titan.exchange'den ceker ve data.json olarak yazar.

Bu script GitHub Actions tarafindan zamanlanmis sekilde calistirilir
(ayrica elle de calistirabilirsin: python3 build_data.py).
Sunucu/baglanti gerektirmez; sadece Python standart kutuphanesi.

Cikti: data.json  ->  {"all": {...}, "1": {...}, "2": {...}, "3": {...}, "4": {...}}
GitHub Pages'teki index.html acilirken bu dosyayi ceker.
"""

import json
import time
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

# Tek-token/tek-market odul kampanyalari.
# epoch=None tum kampanya anlamina gelir; bazi yeni kampanyalarda epoch ayrimi yoktur.
SINGLE_CAMPAIGNS = {
    "spacex": [None, 1, 2],
    "micron": [None, 1, 2],
    "robostrategy": [None],
    "solstice": [None],
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
    tokens = get("/api/tokens/prestocks").get("results", [])
    print(f"{len(tokens)} token bulundu.")
    data = {}
    for ep in EPOCHS:
        key = "all" if ep is None else str(ep)
        data[key] = build_epoch(ep, tokens)
        print(f"  {key:>3}: ${round(data[key]['grandVolume']):,}")
    # Tek-token/tek-market kampanyalar (SpaceX, Micron, RoboStrategy, Solstice)
    for slug, epochs in SINGLE_CAMPAIGNS.items():
        data[slug] = {}
        for ep in epochs:
            data[slug]["all" if ep is None else str(ep)] = build_campaign_epoch(slug, ep)
        print(f"  {slug}/all: ${round(data[slug]['all']['volume']):,}")
    with open("data.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("data.json yazildi.")


if __name__ == "__main__":
    main()
