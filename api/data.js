// Vercel sunucusuz fonksiyon — PreStocks hacim verisini titan.exchange'den CANLI ceker.
//
// Tarayici titan.exchange API'sini dogrudan cagiramaz (Origin korumasi). Bu fonksiyon
// sunucu tarafinda calistigi icin Origin header'ini ekleyebilir ve veriyi gercek zamanli
// doner. GitHub Actions/cron'a gerek yok — sayfa her acildiginda guncel veri gelir.
//
// Cikti: { all:{...}, "1":{...}, "2":{...}, "3":{...}, "4":{...} }  (data.json ile ayni yapi)
// Sonuc Vercel kenarinda kisa sure (s-maxage) onbellege alinir; cogu ziyaretci onbellekten okur.

const BASE = "https://titan.exchange";
const HEADERS = {
  "Content-Type": "application/json",
  "Origin": "https://titan.exchange",
  "Referer": "https://titan.exchange/prestock",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};
const CAMPAIGN = 4;
const LIMIT = 100;
const EPOCHS = [null, 1, 2, 3, 4]; // null = tum kampanya

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("POST " + path + " -> " + r.status);
  return r.json();
}
async function get(path) {
  const r = await fetch(BASE + path, { headers: HEADERS });
  if (!r.ok) throw new Error("GET " + path + " -> " + r.status);
  return r.json();
}

async function buildEpoch(epoch, tokens) {
  const volKey = epoch === null ? "user_campaign_volume_usd" : "user_epoch_volume_usd";
  const trdKey = epoch === null ? "user_campaign_trades" : "user_epoch_trades";

  const results = await Promise.all(
    tokens.map(async (t) => {
      let lb = [];
      try {
        const d = await post("/api/wallet-stats/prestock-leaderboard", {
          epoch,
          wallet_address: "",
          limit: LIMIT,
          campaign: CAMPAIGN,
          token_contract_address: t.address,
        });
        lb = d.leaderboard || [];
      } catch (e) {
        lb = [];
      }
      const volume = lb.reduce((s, r) => s + (Number(r[volKey]) || 0), 0);
      const trades = lb.reduce((s, r) => s + (Number(r[trdKey]) || 0), 0);
      return {
        symbol: t.symbol,
        name: t.name,
        logo: t.logoURI,
        address: t.address,
        volume,
        trades,
        traders: lb.length,
        capped: lb.length >= LIMIT,
        board: lb.map((r) => ({
          rank: r.rank,
          name: r.username || r.wallet_address || "—",
          volume: Math.round((Number(r[volKey]) || 0) * 100) / 100,
          vip: !!r.is_vip,
        })),
      };
    })
  );

  results.sort((a, b) => b.volume - a.volume);
  return {
    epoch: epoch === null ? "all" : epoch,
    limit: LIMIT,
    campaign: CAMPAIGN,
    tokens: results,
    grandVolume: results.reduce((s, t) => s + t.volume, 0),
    grandTrades: results.reduce((s, t) => s + t.trades, 0),
    tokenCount: results.length,
    generatedAt: Date.now(),
  };
}

// --- SpaceX (SPCX) kampanyasi: ayri endpoint, tek token, campaign_slug ile ---
async function buildSpacexEpoch(epoch) {
  let lb = [];
  try {
    const r = await fetch(BASE + "/api/wallet-stats/campaign-leaderboard", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        campaign_slug: "spacex",
        epoch,
        limit: 100,
        wallet_address: "",
      }),
    });
    if (r.ok) lb = (await r.json()).leaderboard || [];
  } catch (e) {
    lb = [];
  }
  const volKey = epoch === null ? "user_campaign_volume_usd" : "user_epoch_volume_usd";
  const trdKey = epoch === null ? "user_campaign_trades" : "user_epoch_trades";
  return {
    epoch: epoch === null ? "all" : epoch,
    volume: lb.reduce((s, r) => s + (Number(r[volKey]) || 0), 0),
    trades: lb.reduce((s, r) => s + (Number(r[trdKey]) || 0), 0),
    traders: lb.length,
    capped: lb.length >= 100,
    board: lb.map((r) => ({
      rank: r.rank,
      name: r.username || r.wallet_address || "—",
      volume: Math.round((Number(r[volKey]) || 0) * 100) / 100,
      vip: !!r.is_vip,
    })),
    generatedAt: Date.now(),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Vercel kenarinda 60 sn onbellek; arka planda 5 dk tazeleme
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  try {
    const tokens = (await get("/api/tokens/prestocks")).results || [];
    // Tum epoch'lari paralel cek (hiz icin)
    const built = await Promise.all(EPOCHS.map((ep) => buildEpoch(ep, tokens)));
    const out = {};
    EPOCHS.forEach((ep, i) => {
      out[ep === null ? "all" : String(ep)] = built[i];
    });
    // SpaceX (SPCX) kampanyasi — 2 epoch, paralel cek
    const sx = await Promise.all([null, 1, 2].map(buildSpacexEpoch));
    out.spacex = { all: sx[0], "1": sx[1], "2": sx[2] };
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
