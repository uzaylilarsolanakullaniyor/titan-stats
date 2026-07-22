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
// Titan'in mevcut PreStocks gecmisi. Her yenilemede bunun sonrasini da
// sorgulariz; Titan yeni epoch acinca kod degisikligi gerektirmeden eklenir.
const KNOWN_PRESTOCK_EPOCHS = [1, 2, 3, 4];
const MAX_PRESTOCK_EPOCHS = 24;
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
async function getText(path) {
  const url = new URL(path, BASE);
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error("GET " + url.pathname + " -> " + r.status);
  return r.text();
}

async function getPrestockTokens() {
  const payload = await get("/api/tokens/lists?include=prestocks");
  const list = payload?.lists?.prestocks;
  if (!list?.success || !Array.isArray(list.results) || !list.results.length) {
    throw new Error("PreStocks token list is empty or invalid");
  }
  return list.results;
}

async function discoverPrestockEpochs(tokens) {
  const epochs = [...KNOWN_PRESTOCK_EPOCHS];
  const sample = tokens.find(token => token?.address);
  if (!sample) return epochs;

  for (let epoch = epochs.at(-1) + 1; epoch <= MAX_PRESTOCK_EPOCHS; epoch++) {
    try {
      const payload = await post("/api/wallet-stats/prestock-leaderboard", {
        epoch,
        wallet_address: "",
        limit: 1,
        campaign: CAMPAIGN,
        token_contract_address: sample.address,
      });
      // Gecerli ama henuz islem olmayan bir epoch bile success/epoch alanlarini
      // dondurur. Gelecekteki epoch'lar ise Titan tarafinda hata verir.
      if (!payload?.success || Number(payload.epoch) !== epoch) break;
      epochs.push(epoch);
    } catch (e) {
      break;
    }
  }
  return epochs;
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

function parseJsNumber(value) {
  let source = String(value || "").trim();
  if (source.includes("?") && source.includes(":")) source = source.split(":").pop().trim();
  const match = source.match(/^(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
  return match ? Number(match[0]) : 0;
}

function parseRewardsCampaignBundle(source) {
  const blocks = [];
  const marker = /\{id:\d+,slug:"[^"]+",name:"[^"]+"/g;
  let found;
  while ((found = marker.exec(source))) {
    const start = found.index;
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < source.length; index++) {
      const char = source[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") quote = char;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        blocks.push(source.slice(start, index + 1));
        break;
      }
    }
  }

  const textField = (block, name) => {
    const match = block.match(new RegExp(`${name}:"((?:\\\\.|[^"])*)"`));
    return match ? match[1] : "";
  };
  const numberField = (block, name) => {
    const match = block.match(new RegExp(`${name}:([^,}]+)`));
    return match ? parseJsNumber(match[1]) : 0;
  };
  const decodeJsString = value => {
    try { return JSON.parse(`"${value}"`); } catch (e) { return value; }
  };

  return blocks.map(block => {
    const slug = textField(block, "slug");
    const name = textField(block, "name");
    if (!slug || !name) return null;
    const startMatch = block.match(/startTime:(.*?),endTime:/);
    const endMatch = block.match(/endTime:([^,}]+)/);
    const startTime = startMatch ? parseJsNumber(startMatch[1]) : 0;
    const endTime = endMatch ? parseJsNumber(endMatch[1]) : 0;
    const epochRanges = {};
    const epochsMatch = block.match(/epochs:\[(.*?)\](?:,tokenAddress|,rewardTokenAddress|})/s);
    if (epochsMatch) {
      const pattern = /\{id:(\d+),label:"[^"]*",startTime:(.*?),endTime:([^}]+)\}/g;
      let epoch;
      while ((epoch = pattern.exec(epochsMatch[1]))) {
        epochRanges[epoch[1]] = {
          startTime: parseJsNumber(epoch[2]),
          endTime: parseJsNumber(epoch[3]),
        };
      }
    }
    epochRanges.all = { startTime, endTime };
    const logo = textField(block, "logoUrl");
    return {
      slug,
      name,
      logo: logo ? new URL(logo, BASE).href : "",
      description: decodeJsString(textField(block, "description")),
      startTime,
      endTime,
      totalEpoch: numberField(block, "totalEpoch"),
      totalRewards: numberField(block, "totalRewards"),
      epochRewards: numberField(block, "epochRewards"),
      epochRanges,
      tokenAddress: textField(block, "tokenAddress"),
    };
  }).filter(Boolean);
}

async function discoverRewardsPageCampaigns() {
  const page = await getText("/rewards");
  const scripts = [...new Set(
    [...page.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map(match => match[1])
      .filter(path => path.includes(".js"))
  )];
  const sources = await Promise.all(scripts.map(async path => {
    try { return await getText(path); } catch (e) { return ""; }
  }));
  for (const source of sources) {
    if (!source.includes("ALL_CAMPAIGNS") || !source.includes("SLUG_BASED_CAMPAIGNS")) continue;
    const campaigns = parseRewardsCampaignBundle(source);
    if (campaigns.length) return campaigns;
  }
  return [];
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
  const seenAt = Math.floor(Date.now() / 1000);

  let rewardsCampaigns = [];
  try { rewardsCampaigns = await discoverRewardsPageCampaigns(); } catch (e) {}
  const rewardsSlugs = new Set(rewardsCampaigns.map(item => item.slug).filter(Boolean));

  let announcements = [];
  try {
    const response = await post("/api/campaigns/get", {
      wallet_address: "",
      user_triggers: { connected: false, is_vip: false, not_vip: false, no_sponsored_tx: false },
    });
    announcements = [
      ...(response.banner_campaigns || []),
      ...(response.toast_campaigns || []),
      ...(response.modal_campaigns || []),
    ];
  } catch (e) {}

  const addresses = [...new Set([
    ...rewardsCampaigns.map(item => item.tokenAddress),
    ...announcements.map(item => item.output_mint),
  ].filter(Boolean))];
  let tokenResponse = { results: [] };
  try {
    if (addresses.length) tokenResponse = await post("/api/tokens/multiple", { addresses });
  } catch (e) {}
  const tokens = Object.fromEntries((tokenResponse.results || []).map(token => [token.address, token]));

  const upsert = ({ slug, rawName, symbol, start, end, epochCount, totalReward,
    epochReward = 0, epochRanges = null, tokenAddress = "", logo = "" }) => {
    const existing = campaigns[slug] || {};
    const previousMeta = existing.meta || {};
    const count = Math.max(1, Math.min(12, Number(epochCount) || 1));
    const ranges = { ...(epochRanges && Object.keys(epochRanges).length
      ? epochRanges
      : previousMeta.epochRanges || {}) };
    if (start && end) {
      ranges.all ||= { startTime: start, endTime: end };
      const epochSpan = (end - start) / count;
      for (let epochNumber = 1; epochNumber <= count; epochNumber++) {
        const epochStart = Math.round(start + (epochNumber - 1) * epochSpan);
        ranges[String(epochNumber)] ||= {
          startTime: epochStart,
          endTime: epochNumber === count ? end : Math.round(start + epochNumber * epochSpan),
        };
      }
    }
    const labelName = String(rawName || "").replace(/\s+campaign\s*$/i, "").trim()
      || symbol || slug.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
    campaigns[slug] = {
      epochs: [null, ...Array.from({ length: count }, (_, i) => i + 1)],
      meta: {
        ...previousMeta,
        label: previousMeta.label || (symbol ? `${labelName} · ${symbol}` : labelName),
        symbol: symbol || previousMeta.symbol || slug.toUpperCase(),
        epochs: ["all", ...Array.from({ length: count }, (_, i) => String(i + 1))],
        campaignPool: totalReward || previousMeta.campaignPool || 0,
        epochPool: epochReward || (totalReward ? totalReward / count : previousMeta.epochPool || 0),
        topN: previousMeta.topN || 100,
        costRate: previousMeta.costRate || 0.0003,
        startTime: start || previousMeta.startTime || 0,
        endTime: end || previousMeta.endTime || 0,
        lastSeenAt: seenAt,
        epochRanges: ranges,
        tokenAddress: tokenAddress || previousMeta.tokenAddress || "",
        logo: logo || previousMeta.logo || "",
      },
    };
  };

  // Rewards sayfasinin ALL_CAMPAIGNS listesi asil kaynaktir; banner API'sinde
  // bulunmayan canli kampanyalar da burada yer alir.
  for (const item of rewardsCampaigns) {
    const slug = item.slug || "";
    const tokenAddress = item.tokenAddress || "";
    if (!slug || (!tokenAddress && !campaigns[slug])) continue;
    const token = tokens[tokenAddress] || {};
    const symbolMatch = String(item.description || "").match(/\$([A-Z][A-Z0-9]*)/);
    const previousSymbol = campaigns[slug]?.meta?.symbol || "";
    const symbol = token.symbol || previousSymbol || (symbolMatch ? symbolMatch[1] : "");
    upsert({
      slug,
      rawName: item.name,
      symbol,
      start: Number(item.startTime) || 0,
      end: Number(item.endTime) || 0,
      epochCount: Number(item.totalEpoch) || 1,
      totalReward: Number(item.totalRewards) || 0,
      epochReward: Number(item.epochRewards) || 0,
      epochRanges: item.epochRanges,
      tokenAddress,
      logo: token.logoURI || item.logo || "",
    });
  }

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
    if (!slug) continue;

    let start = Number(item.campaignStartDate || 0);
    let end = Number(item.campaignEndDate || 0);
    const existing = campaigns[slug] || {};
    // Banner penceresi kampanyanin asil suresinden kisa olabilir.
    if (rewardsSlugs.has(slug)) {
      start = Number(existing.meta?.startTime) || start;
      end = Number(existing.meta?.endTime) || end;
    }
    const duration = Math.max(0, end - start);
    const epochCount = duration
      ? Math.max(1, Math.min(12, Math.ceil(duration / (7 * 24 * 60 * 60))))
      : Math.max(1, (existing.epochs || []).filter(epoch => epoch !== null).length);
    const totalReward = parseRewardAmount(`${item.title || ""} ${item.description || ""}`);
    const labelName = rawName || symbol || slug.replace(/-/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
    upsert({
      slug,
      rawName: labelName,
      symbol,
      start,
      end,
      epochCount,
      totalReward,
      tokenAddress: item.output_mint,
      logo: token.logoURI || item.image || "",
    });
  }
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
  // Sabit /api/data URL'si eski veriyi aninda sunar, Vercel arka planda tazeler.
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=86400");
  try {
    const [tokenResponse, campaignDefs] = await Promise.all([
      getPrestockTokens(),
      discoverCampaignDefs(),
    ]);
    const tokens = tokenResponse;
    const prestockEpochs = [null, ...(await discoverPrestockEpochs(tokens))];
    // Tum epoch'lari paralel cek (hiz icin)
    const built = await Promise.all(prestockEpochs.map((ep) => buildEpoch(ep, tokens)));
    const out = {};
    prestockEpochs.forEach((ep, i) => {
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
