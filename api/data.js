// Vercel sunucusuz fonksiyon — PreStocks hacim verisini titan.exchange'den CANLI ceker.
//
// Tarayici titan.exchange API'sini dogrudan cagiramaz (Origin korumasi). Bu fonksiyon
// sunucu tarafinda calistigi icin Origin header'ini ekleyebilir ve veriyi gercek zamanli
// doner. GitHub Actions/cron'a gerek yok — sayfa her acildiginda guncel veri gelir.
//
// Cikti: PreStocks epoch'lari + otomatik kesfedilen kampanyalar ve metadata (data.json ile ayni yapi)
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
const FALLBACK_CAMPAIGNS = {
  spacex: {
    epochs: [null, 1, 2],
    meta: { label: "SpaceX · SPCX", symbol: "SPCX", epochs: ["all", "1", "2"], campaignPool: 10000, epochPool: 5000, topN: 100, costRate: 0.0003 },
  },
  micron: {
    epochs: [null, 1, 2],
    meta: { label: "Micron · MU", symbol: "MU", epochs: ["all", "1", "2"], campaignPool: 10000, epochPool: 5000, topN: 100, costRate: 0.0003 },
  },
  robostrategy: {
    epochs: [null, 1, 2],
    meta: { label: "RoboStrategy · BOT", symbol: "BOT", epochs: ["all", "1", "2"], campaignPool: 10000, epochPool: 5000, topN: 100, costRate: 0.0003 },
  },
  solstice: {
    epochs: [null, 1, 2, 3, 4],
    meta: { label: "Solstice · SLX", symbol: "SLX", epochs: ["all", "1", "2", "3", "4"], campaignPool: 30000, epochPool: 7500, topN: 100, costRate: 0.0003 },
  },
};

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

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseRewardAmount(text) {
  const match = String(text || "").match(/\$?([\d,]+(?:\.\d+)?)\s*USDC(?:\s+in)?\s+rewards/i);
  return match ? Number(match[1].replace(/,/g, "")) : 0;
}

async function resolveCampaignSlug(candidates) {
  for (const slug of [...new Set(candidates.filter(Boolean))]) {
    try {
      const data = await post("/api/wallet-stats/campaign-leaderboard", {
        campaign_slug: slug,
        epoch: null,
        limit: 1,
        wallet_address: "",
      });
      if (Array.isArray(data.leaderboard)) return data.campaign_slug || slug;
    } catch (e) {}
  }
  return null;
}

async function discoverCampaignDefs() {
  const campaigns = Object.fromEntries(
    Object.entries(FALLBACK_CAMPAIGNS).map(([slug, cfg]) => [slug, {
      epochs: [...cfg.epochs],
      meta: { ...cfg.meta },
    }])
  );
  try {
    const response = await post("/api/campaigns/get", {
      wallet_address: "",
      user_triggers: { connected: false, is_vip: false, not_vip: false, no_sponsored_tx: false },
    });
    const announcements = [
      ...(response.banner_campaigns || []),
      ...(response.toast_campaigns || []),
      ...(response.modal_campaigns || []),
    ];
    const addresses = [...new Set(announcements.map(item => item.output_mint).filter(Boolean))];
    const tokenResponse = addresses.length
      ? await post("/api/tokens/multiple", { addresses })
      : { results: [] };
    const tokens = Object.fromEntries((tokenResponse.results || []).map(token => [token.address, token]));

    for (const item of announcements) {
      if (!item.campaign_id || !item.output_mint) continue;
      const token = tokens[item.output_mint] || {};
      const rawName = String(token.name || "").split(" - ")[0].trim();
      const symbolMatch = `${item.title || ""} ${item.description || ""}`.match(/\$([A-Z][A-Z0-9]*)/);
      const symbol = token.symbol || (symbolMatch ? symbolMatch[1] : "");
      const idBase = String(item.campaign_id).replace(/-(?:banner|toast|modal)(?:-.*)?$/i, "");
      const candidates = [
        slugify(rawName),
        slugify(rawName.split(/\s+/)[0]),
        slugify(idBase),
        slugify(symbol),
      ];
      const known = candidates.find(candidate => campaigns[candidate]);
      const slug = known || await resolveCampaignSlug(candidates);
      if (!slug || campaigns[slug]) continue;

      const start = Number(item.campaignStartDate || 0);
      const end = Number(item.campaignEndDate || 0);
      const epochCount = Math.max(1, Math.min(12, Math.ceil(Math.max(0, end - start) / (7 * 24 * 60 * 60))));
      const totalReward = parseRewardAmount(`${item.title || ""} ${item.description || ""}`);
      const labelName = rawName || symbol || slug.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
      campaigns[slug] = {
        epochs: [null, ...Array.from({ length: epochCount }, (_, i) => i + 1)],
        meta: {
          label: symbol ? `${labelName} · ${symbol}` : labelName,
          symbol: symbol || slug.toUpperCase(),
          epochs: ["all", ...Array.from({ length: epochCount }, (_, i) => String(i + 1))],
          campaignPool: totalReward,
          epochPool: totalReward ? totalReward / epochCount : 0,
          topN: 100,
          costRate: 0.0003,
          startTime: start,
          endTime: end,
          tokenAddress: item.output_mint,
          logo: token.logoURI || item.image,
        },
      };
    }
  } catch (e) {}
  return campaigns;
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

// --- Tek-token/tek-market kampanyalar (SpaceX, Micron, RoboStrategy, Solstice, ...): ayri endpoint, campaign_slug ile ---
async function buildCampaignEpoch(slug, epoch) {
  let lb = [];
  try {
    const r = await fetch(BASE + "/api/wallet-stats/campaign-leaderboard", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({
        campaign_slug: slug,
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
    const [tokenResponse, campaignDefs] = await Promise.all([
      get("/api/tokens/prestocks"),
      discoverCampaignDefs(),
    ]);
    const tokens = tokenResponse.results || [];
    // Tum epoch'lari paralel cek (hiz icin)
    const built = await Promise.all(EPOCHS.map((ep) => buildEpoch(ep, tokens)));
    const out = {};
    EPOCHS.forEach((ep, i) => {
      out[ep === null ? "all" : String(ep)] = built[i];
    });
    // Tek-token/tek-market kampanyalar. Bazilarinda epoch ayrimi yoktur.
    const camp = await Promise.all(
      Object.entries(campaignDefs).map(async ([slug, config]) => {
        const eps = await Promise.all(config.epochs.map((e) => buildCampaignEpoch(slug, e)));
        const data = { meta: config.meta };
        config.epochs.forEach((ep, idx) => { data[ep === null ? "all" : String(ep)] = eps[idx]; });
        return [slug, data];
      })
    );
    camp.forEach(([slug, data]) => { out[slug] = data; });
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
