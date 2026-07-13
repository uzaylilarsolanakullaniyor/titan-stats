#!/usr/bin/env python3
"""
Titan PreStocks — Hacim Analiz Sunucusu

titan.exchange API'si "Origin" kontrolü yaptigi icin tarayicidan dogrudan
cagrilamaz. Bu kucuk sunucu:
  - index.html sayfasini sunar
  - /api/data ucunda 7 PreStocks token'inin hacimlerini titan.exchange'den
    ceker, toplar ve tek bir JSON olarak doner (Origin header'i sunucu ekler)

Hicbir harici bagimlilik yok; sadece Python standart kutuphanesi.

Calistir:  python3 server.py
Ac:        http://localhost:8000
"""

import json
import os
import time
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = 8000
HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://titan.exchange"
HEADERS = {
    "Content-Type": "application/json",
    "Origin": "https://titan.exchange",
    "Referer": "https://titan.exchange/prestock",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
}
# PreStocks kampanyasinin id'si (frontend: PRE_STOCKS_CAMPAIGN_4_DATA.id)
CAMPAIGN = 4
LIMIT = 100  # API ucundaki ust sinir

_cache = {}            # epoch -> (timestamp, payload)
_CACHE_TTL = 60        # saniye


def _post(path, body):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(body).encode(), headers=HEADERS, method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def _get(path):
    req = urllib.request.Request(BASE + path, headers=HEADERS, method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_tokens():
    """PreStocks token listesini canli ceker (sembol, logo, adres)."""
    d = _get("/api/tokens/prestocks")
    return d.get("results", [])


def build_data(epoch):
    """
    epoch: None (tum kampanya) veya 1..4
    Her token icin lider tablosunu cekip hacimleri toplar.
    """
    api_epoch = None if epoch in (None, "all", "null", "") else int(epoch)
    tokens = fetch_tokens()
    out = []
    grand_volume = 0.0
    grand_trades = 0

    vol_key = "user_campaign_volume_usd" if api_epoch is None else "user_epoch_volume_usd"
    trd_key = "user_campaign_trades" if api_epoch is None else "user_epoch_trades"

    for t in tokens:
        body = {
            "epoch": api_epoch,
            "wallet_address": "",
            "limit": LIMIT,
            "campaign": CAMPAIGN,
            "token_contract_address": t["address"],
        }
        try:
            d = _post("/api/wallet-stats/prestock-leaderboard", body)
            lb = d.get("leaderboard", []) or []
        except Exception:
            lb = []

        volume = sum(float(r.get(vol_key) or 0) for r in lb)
        trades = sum(int(r.get(trd_key) or 0) for r in lb)
        board = [
            {
                "rank": r.get("rank"),
                "name": r.get("username") or r.get("wallet_address") or "—",
                "volume": round(float(r.get(vol_key) or 0), 2),
                "vip": bool(r.get("is_vip")),
            }
            for r in lb
        ]

        grand_volume += volume
        grand_trades += trades
        out.append({
            "symbol": t.get("symbol"),
            "name": t.get("name"),
            "logo": t.get("logoURI"),
            "address": t.get("address"),
            "volume": volume,
            "trades": trades,
            "traders": len(lb),
            "capped": len(lb) >= LIMIT,
            "board": board,
        })

    out.sort(key=lambda x: x["volume"], reverse=True)
    return {
        "epoch": "all" if api_epoch is None else api_epoch,
        "limit": LIMIT,
        "campaign": CAMPAIGN,
        "tokens": out,
        "grandVolume": grand_volume,
        "grandTrades": grand_trades,
        "tokenCount": len(out),
        "generatedAt": int(time.time() * 1000),
    }


def get_data(epoch):
    key = str(epoch)
    now = time.time()
    if key in _cache and now - _cache[key][0] < _CACHE_TTL:
        return _cache[key][1]
    data = build_data(epoch)
    _cache[key] = (now, data)
    return data


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # sessiz

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            try:
                with open(os.path.join(HERE, "index.html"), "rb") as f:
                    self._send(200, f.read(), "text/html; charset=utf-8")
            except FileNotFoundError:
                self._send(404, "index.html bulunamadi", "text/plain; charset=utf-8")
            return

        if parsed.path == "/data.json":
            try:
                with open(os.path.join(HERE, "data.json"), "rb") as f:
                    self._send(200, f.read())
            except FileNotFoundError:
                self._send(404, json.dumps({"error": "data.json not found"}))
            return

        if parsed.path == "/api/data":
            q = parse_qs(parsed.query)
            epoch = q.get("epoch", ["all"])[0]
            try:
                data = get_data(epoch)
                self._send(200, json.dumps(data))
            except Exception as e:
                self._send(502, json.dumps({"error": str(e)}))
            return

        self._send(404, json.dumps({"error": "not found"}))


def main():
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"\n  Titan PreStocks Analiz  →  http://localhost:{PORT}\n")
    print("  Durdurmak icin: Ctrl+C\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  Kapatildi.\n")
        srv.shutdown()


if __name__ == "__main__":
    main()
