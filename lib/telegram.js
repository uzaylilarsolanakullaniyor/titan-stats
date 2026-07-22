import { createHash, timingSafeEqual, webcrypto } from "node:crypto";

const TELEGRAM_API = "https://api.telegram.org";
const DEFAULT_APP_URL = "https://titan-stats.vercel.app";
const REDIS_PREFIX = "titan-stats:telegram";
const MAX_FOLLOWS = 8;
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "titan-stats-telegram";
const GITHUB_REPOSITORY = "uzaylilarsolanakullaniyor/titan-stats";
const GITHUB_WORKFLOW = ".github/workflows/titan-automation.yml";

const TEXT = {
  en: {
    welcome: "Welcome to Titan Stats Bot. I track campaigns, epochs, wallets and live data health.\n\nUse /help to see all commands.",
    help: "Titan Stats commands\n\n/campaigns — active campaigns\n/campaign <name> — campaign details\n/epoch — latest PreStocks epoch\n/epoch 2 — a specific epoch\n/wallet <username> — wallet/user volume\n/follow <username> — follow a user\n/unfollow <username> — stop following\n/following — followed users\n/alerts on|off — notifications\n/lang en|tr — language\n/status — data health",
    usageWallet: "Usage: /wallet username",
    usageCampaign: "Usage: /campaign campaign-name",
    usageFollow: "Usage: /follow username",
    usageUnfollow: "Usage: /unfollow username",
    noCampaigns: "No active or upcoming campaigns were found.",
    noCampaign: "Campaign not found.",
    noEpoch: "Epoch data was not found.",
    noWallet: "This user is not visible in the top-100 leaderboards for the selected epoch.",
    storageUnavailable: "Personal tracking is being activated. Public commands are available now; please try this command again shortly.",
    genericError: "The data service is temporarily unavailable. Please try again shortly.",
    followed: name => `Following ${name}. You will be notified about meaningful ranking changes.`,
    alreadyFollowed: name => `${name} is already followed.`,
    unfollowed: name => `Stopped following ${name}.`,
    notFollowed: name => `${name} is not in your follow list.`,
    followingNone: "You are not following anyone yet.",
    followingTitle: "Followed users",
    followLimit: `You can follow up to ${MAX_FOLLOWS} users.`,
    alertsOn: "Campaign, epoch and followed-user alerts are on.",
    alertsOff: "Alerts are off. Commands will keep working.",
    alertsUsage: "Usage: /alerts on or /alerts off",
    languageSet: "Language changed to English.",
    languageUsage: "Usage: /lang en or /lang tr",
    live: "Live",
    upcoming: "Upcoming",
    ended: "Ended",
    startsIn: "starts",
    endsIn: "ends",
    totalVolume: "Total volume",
    totalTrades: "Total trades",
    tokens: "Tokens",
    latestEpoch: "Latest PreStocks epoch",
    dataFresh: "Live data",
    dataAge: "Data age",
    source: "Source",
    rank: "rank",
    volume: "volume",
    walletTitle: name => `Wallet/user: ${name}`,
    campaignStarted: name => `🚀 ${name} has started.`,
    campaignEnded: name => `🏁 ${name} has ended.`,
    campaignDiscovered: name => `🆕 New campaign: ${name}.`,
    epochChanged: (name, previous, current) => `⏱ ${name}: Epoch ${previous} ended, Epoch ${current} started.`,
    prestockEpoch: epoch => `⏱ PreStocks Epoch ${epoch} is now live.`,
    rankImproved: (name, before, after) => `📈 ${name} improved from rank #${before} to #${after}.`,
    rankDropped: (name, before, after) => `📉 ${name} moved from rank #${before} to #${after}.`,
    notificationTitle: "Titan Stats update",
  },
  tr: {
    welcome: "Titan Stats Bot'a hoş geldin. Kampanyaları, epoch'ları, kullanıcı hacimlerini ve canlı veri sağlığını takip ederim.\n\nTüm komutlar için /help yaz.",
    help: "Titan Stats komutları\n\n/campaigns — aktif kampanyalar\n/campaign <isim> — kampanya detayı\n/epoch — son PreStocks epoch'u\n/epoch 2 — belirli bir epoch\n/wallet <kullanıcı> — hacim ve sıralama\n/follow <kullanıcı> — kullanıcıyı takip et\n/unfollow <kullanıcı> — takibi bırak\n/following — takip edilenler\n/alerts on|off — bildirimler\n/lang en|tr — dil\n/status — veri sağlığı",
    usageWallet: "Kullanım: /wallet kullanıcı_adı",
    usageCampaign: "Kullanım: /campaign kampanya-adı",
    usageFollow: "Kullanım: /follow kullanıcı_adı",
    usageUnfollow: "Kullanım: /unfollow kullanıcı_adı",
    noCampaigns: "Aktif veya yaklaşan kampanya bulunamadı.",
    noCampaign: "Kampanya bulunamadı.",
    noEpoch: "Epoch verisi bulunamadı.",
    noWallet: "Bu kullanıcı seçili epoch'un ilk 100 sıralamalarında görünmüyor.",
    storageUnavailable: "Kişisel takip sistemi etkinleştiriliyor. Genel komutlar şu anda çalışıyor; bu komutu kısa süre sonra tekrar dene.",
    genericError: "Veri servisine geçici olarak ulaşılamıyor. Biraz sonra tekrar dene.",
    followed: name => `${name} takip ediliyor. Önemli sıralama değişikliklerinde bildirim alacaksın.`,
    alreadyFollowed: name => `${name} zaten takip ediliyor.`,
    unfollowed: name => `${name} takibi bırakıldı.`,
    notFollowed: name => `${name} takip listende değil.`,
    followingNone: "Henüz kimseyi takip etmiyorsun.",
    followingTitle: "Takip edilen kullanıcılar",
    followLimit: `En fazla ${MAX_FOLLOWS} kullanıcı takip edebilirsin.`,
    alertsOn: "Kampanya, epoch ve takip edilen kullanıcı bildirimleri açık.",
    alertsOff: "Bildirimler kapalı. Komutlar çalışmaya devam edecek.",
    alertsUsage: "Kullanım: /alerts on veya /alerts off",
    languageSet: "Dil Türkçe olarak değiştirildi.",
    languageUsage: "Kullanım: /lang en veya /lang tr",
    live: "Canlı",
    upcoming: "Yaklaşıyor",
    ended: "Bitti",
    startsIn: "başlangıç",
    endsIn: "bitiş",
    totalVolume: "Toplam hacim",
    totalTrades: "Toplam işlem",
    tokens: "Token",
    latestEpoch: "Son PreStocks epoch'u",
    dataFresh: "Canlı veri",
    dataAge: "Veri yaşı",
    source: "Kaynak",
    rank: "sıra",
    volume: "hacim",
    walletTitle: name => `Cüzdan/kullanıcı: ${name}`,
    campaignStarted: name => `🚀 ${name} başladı.`,
    campaignEnded: name => `🏁 ${name} sona erdi.`,
    campaignDiscovered: name => `🆕 Yeni kampanya: ${name}.`,
    epochChanged: (name, previous, current) => `⏱ ${name}: Epoch ${previous} bitti, Epoch ${current} başladı.`,
    prestockEpoch: epoch => `⏱ PreStocks Epoch ${epoch} başladı.`,
    rankImproved: (name, before, after) => `📈 ${name} #${before} sırasından #${after} sırasına yükseldi.`,
    rankDropped: (name, before, after) => `📉 ${name} #${before} sırasından #${after} sırasına geriledi.`,
    notificationTitle: "Titan Stats güncellemesi",
  },
};

function telegramToken() {
  return process.env.TELEGRAM_BOT_TOKEN || "";
}

export function telegramConfigured() {
  return Boolean(telegramToken());
}

function redisCredentials() {
  const knownPairs = [
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["STORAGE_REST_API_URL", "STORAGE_REST_API_TOKEN"],
    ["STORAGE_REST_URL", "STORAGE_REST_TOKEN"],
    ["STORAGE_URL", "STORAGE_TOKEN"],
  ];
  for (const [urlKey, tokenKey] of knownPairs) {
    if (process.env[urlKey] && process.env[tokenKey]) {
      return { url: process.env[urlKey], token: process.env[tokenKey] };
    }
  }

  // Vercel Marketplace lets users choose any prefix (for example STORAGE).
  // Pair the injected Upstash URL with the closest writable token so custom
  // prefixes keep working without asking users to duplicate secrets manually.
  const entries = Object.entries(process.env);
  const urls = entries.filter(([key, value]) =>
    /(UPSTASH|REDIS|STORAGE)/i.test(key) && /URL$/i.test(key) && /^https:\/\//i.test(value || "")
  );
  const tokens = entries.filter(([key, value]) =>
    /(UPSTASH|REDIS|STORAGE)/i.test(key) && /TOKEN$/i.test(key) && !/READ_ONLY/i.test(key) && Boolean(value)
  );
  for (const [urlKey, url] of urls) {
    const prefix = urlKey.split(/_(?:REDIS_)?(?:REST_API_|REST_)?URL$/i)[0];
    const match = tokens.find(([tokenKey]) => tokenKey.startsWith(`${prefix}_`));
    if (match) return { url, token: match[1] };
  }
  return { url: "", token: "" };
}

function redisUrl() {
  return redisCredentials().url;
}

function redisToken() {
  return redisCredentials().token;
}

export function storageConfigured() {
  return Boolean(redisUrl() && redisToken());
}

function appUrl() {
  return String(process.env.TITAN_STATS_BASE_URL || DEFAULT_APP_URL).replace(/\/$/, "");
}

function webhookUrl() {
  return String(process.env.TELEGRAM_WEBHOOK_URL || `${appUrl()}/api/telegram`);
}

export function webhookSecret() {
  const token = telegramToken();
  return token
    ? createHash("sha256").update(`titan-stats:${token}`).digest("base64url").slice(0, 64)
    : "";
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function telegramCall(method, body = {}) {
  const token = telegramToken();
  if (!token) throw new Error("Telegram is not configured");
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    const error = new Error(payload.description || `Telegram ${method} failed`);
    error.status = response.status;
    error.code = payload.error_code;
    throw error;
  }
  return payload.result;
}

export async function sendTelegramMessage(chatId, text) {
  return telegramCall("sendMessage", {
    chat_id: chatId,
    text: String(text).slice(0, 4096),
    disable_web_page_preview: true,
  });
}

async function redisCommand(...command) {
  if (!storageConfigured()) throw new Error("Storage is not configured");
  const response = await fetch(redisUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error || "Redis request failed");
  return payload.result;
}

async function redisPipeline(commands) {
  if (!storageConfigured()) throw new Error("Storage is not configured");
  const response = await fetch(`${redisUrl().replace(/\/$/, "")}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(payload)) throw new Error("Redis pipeline failed");
  const failed = payload.find(item => item?.error);
  if (failed) throw new Error(failed.error);
  return payload.map(item => item.result);
}

const chatKey = chatId => `${REDIS_PREFIX}:chat:${chatId}`;
const chatsKey = `${REDIS_PREFIX}:chats`;
const stateKey = `${REDIS_PREFIX}:campaign-state`;
const updateKey = updateId => `${REDIS_PREFIX}:update:${updateId}`;

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function getChat(chatId) {
  if (!storageConfigured()) return null;
  return parseJson(await redisCommand("GET", chatKey(chatId)), null);
}

async function saveChat(settings) {
  if (!storageConfigured()) return false;
  settings.updatedAt = Date.now();
  await redisPipeline([
    ["SET", chatKey(settings.chatId), JSON.stringify(settings)],
    ["SADD", chatsKey, String(settings.chatId)],
  ]);
  return true;
}

async function deleteChat(chatId) {
  if (!storageConfigured()) return;
  await redisPipeline([
    ["DEL", chatKey(chatId)],
    ["SREM", chatsKey, String(chatId)],
  ]);
}

async function allChats() {
  if (!storageConfigured()) return [];
  const ids = await redisCommand("SMEMBERS", chatsKey) || [];
  if (!ids.length) return [];
  const rows = await redisPipeline(ids.map(id => ["GET", chatKey(id)]));
  return rows.map(row => parseJson(row, null)).filter(Boolean);
}

async function acceptUpdate(updateId) {
  if (!storageConfigured() || updateId == null) return true;
  return (await redisCommand("SET", updateKey(updateId), "1", "NX", "EX", 86400)) === "OK";
}

function normalizeLanguage(value) {
  return String(value || "").toLowerCase().startsWith("tr") ? "tr" : "en";
}

function initialSettings(message) {
  const chatId = String(message.chat.id);
  return {
    chatId,
    chatType: message.chat.type || "private",
    language: normalizeLanguage(message.from?.language_code),
    alerts: true,
    follows: [],
    walletState: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function getOrCreateSettings(message) {
  const existing = await getChat(message.chat.id);
  return existing || initialSettings(message);
}

export async function fetchTitanData() {
  const response = await fetch(`${appUrl()}/api/data`, {
    headers: { Accept: "application/json", "User-Agent": "Titan-Stats-Telegram/1.0" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.all?.tokens) throw new Error(payload.error || "Titan data unavailable");
  return payload;
}

function numericEpochs(data) {
  return Object.keys(data || {})
    .filter(key => /^\d+$/.test(key) && Array.isArray(data[key]?.tokens))
    .map(Number)
    .sort((a, b) => a - b);
}

function latestEpochKey(data) {
  const epochs = numericEpochs(data);
  return epochs.length ? String(epochs.at(-1)) : "all";
}

function campaignEntries(data) {
  return Object.entries(data || {}).filter(([key, value]) =>
    key !== "all" && !/^\d+$/.test(key) && value?.meta && value?.all
  );
}

function timestampMs(value) {
  const number = Number(value) || 0;
  return number > 1e12 ? number : number * 1000;
}

function campaignStatus(meta, now = Date.now()) {
  const start = timestampMs(meta?.startTime);
  const end = timestampMs(meta?.endTime);
  if (start && now < start) return "upcoming";
  if (end && now >= end) return "ended";
  return "live";
}

function activeCampaignEpoch(meta, now = Date.now()) {
  const ranges = meta?.epochRanges || {};
  const active = Object.entries(ranges).find(([key, range]) => {
    if (!/^\d+$/.test(key)) return false;
    const start = timestampMs(range?.startTime);
    const end = timestampMs(range?.endTime);
    return (!start || now >= start) && (!end || now < end);
  });
  if (active) return active[0];
  const epochs = (meta?.epochs || []).filter(value => /^\d+$/.test(String(value))).map(Number);
  return epochs.length ? String(Math.max(...epochs)) : "all";
}

function formatCurrency(value, language) {
  return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatNumber(value, language) {
  return new Intl.NumberFormat(language === "tr" ? "tr-TR" : "en-US", {
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatDuration(target, language) {
  const seconds = Math.max(0, Math.round((target - Date.now()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (language === "tr") {
    if (days) return `${days}g ${hours}sa`;
    if (hours) return `${hours}sa ${minutes}dk`;
    return `${minutes}dk`;
  }
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function campaignLabel(slug, meta) {
  return meta?.label || slug.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function findCampaign(data, query) {
  const normalized = String(query || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return campaignEntries(data).find(([slug, value]) => {
    const candidates = [slug, value.meta?.label, value.meta?.symbol]
      .map(item => String(item || "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
    return candidates.some(candidate => candidate === normalized || candidate.includes(normalized));
  });
}

function findBoardRow(board, query) {
  let wanted = String(query || "").trim().replace(/^@/, "").toLowerCase();
  if (!wanted) return null;
  const exact = (board || []).find(row => String(row.name || "").toLowerCase() === wanted);
  if (exact) return exact;
  const short = wanted.length >= 8 ? `${wanted.slice(0, 4)}...${wanted.slice(-4)}` : "";
  return short ? (board || []).find(row => String(row.name || "").toLowerCase() === short) || null : null;
}

function walletMetrics(data, epochKey, query) {
  const epoch = data?.[epochKey] || data?.all;
  const matches = (epoch?.tokens || []).map(token => {
    const row = findBoardRow(token.board || token.top || [], query);
    return row ? { symbol: token.symbol || token.name || "?", rank: Number(row.rank) || 0, volume: Number(row.volume) || 0 } : null;
  }).filter(Boolean).sort((a, b) => b.volume - a.volume);
  return {
    matches,
    totalVolume: matches.reduce((sum, row) => sum + row.volume, 0),
    bestRank: matches.length ? Math.min(...matches.map(row => row.rank).filter(Boolean)) : null,
  };
}

function campaignListText(data, language) {
  const words = TEXT[language];
  const now = Date.now();
  const visible = campaignEntries(data)
    .map(([slug, value]) => ({ slug, value, status: campaignStatus(value.meta, now) }))
    .filter(item => item.status !== "ended" || now - timestampMs(item.value.meta.endTime) < 7 * 86400000)
    .sort((a, b) => {
      const order = { live: 0, upcoming: 1, ended: 2 };
      return order[a.status] - order[b.status] || timestampMs(a.value.meta.endTime) - timestampMs(b.value.meta.endTime);
    });
  if (!visible.length) return words.noCampaigns;
  const lines = visible.map(({ slug, value, status }) => {
    const meta = value.meta;
    const label = campaignLabel(slug, meta);
    const statusLabel = status === "live" ? words.live : status === "upcoming" ? words.upcoming : words.ended;
    const target = status === "upcoming" ? timestampMs(meta.startTime) : timestampMs(meta.endTime);
    const remaining = target && target > now ? ` · ${status === "upcoming" ? words.startsIn : words.endsIn}: ${formatDuration(target, language)}` : "";
    return `• ${label} — ${statusLabel}${remaining}`;
  });
  return `${language === "tr" ? "Kampanyalar" : "Campaigns"}\n\n${lines.join("\n")}`;
}

function campaignDetailText(data, query, language) {
  const match = findCampaign(data, query);
  if (!match) return TEXT[language].noCampaign;
  const [slug, campaign] = match;
  const words = TEXT[language];
  const meta = campaign.meta;
  const status = campaignStatus(meta);
  const epoch = activeCampaignEpoch(meta);
  const payload = campaign[epoch] || campaign.all;
  const statusLabel = status === "live" ? words.live : status === "upcoming" ? words.upcoming : words.ended;
  const lines = [
    campaignLabel(slug, meta),
    `${language === "tr" ? "Durum" : "Status"}: ${statusLabel}`,
    `Epoch: ${epoch === "all" ? "—" : epoch}`,
    `${words.totalVolume}: ${formatCurrency(payload?.volume, language)}`,
    `${words.totalTrades}: ${formatNumber(payload?.trades, language)}`,
  ];
  if (Number(meta.campaignPool)) lines.push(`${language === "tr" ? "Ödül havuzu" : "Reward pool"}: ${formatCurrency(meta.campaignPool, language)}`);
  const end = timestampMs(meta.endTime);
  if (status === "live" && end) lines.push(`${words.endsIn}: ${formatDuration(end, language)}`);
  return lines.join("\n");
}

function epochText(data, requested, language) {
  const words = TEXT[language];
  const key = requested === "all" ? "all" : requested && /^\d+$/.test(requested) ? requested : latestEpochKey(data);
  const payload = data?.[key];
  if (!payload?.tokens) return words.noEpoch;
  return [
    key === "all" ? "PreStocks — All campaign" : `${words.latestEpoch}: ${key}`,
    `${words.totalVolume}: ${formatCurrency(payload.grandVolume, language)}`,
    `${words.totalTrades}: ${formatNumber(payload.grandTrades, language)}`,
    `${words.tokens}: ${formatNumber(payload.tokenCount, language)}`,
  ].join("\n");
}

function walletText(data, query, language) {
  const words = TEXT[language];
  const key = latestEpochKey(data);
  const metrics = walletMetrics(data, key, query);
  if (!metrics.matches.length) return words.noWallet;
  const rows = metrics.matches.slice(0, 6).map(row =>
    `• ${row.symbol}: #${row.rank} · ${formatCurrency(row.volume, language)}`
  );
  return [
    words.walletTitle(query),
    `Epoch ${key}`,
    `${words.totalVolume}: ${formatCurrency(metrics.totalVolume, language)}`,
    "",
    ...rows,
  ].join("\n");
}

function statusText(data, language) {
  const words = TEXT[language];
  const generatedAt = Number(data?.all?.generatedAt) || 0;
  const ageMinutes = generatedAt ? Math.max(0, Math.floor((Date.now() - generatedAt) / 60000)) : null;
  const age = ageMinutes == null ? "—" : language === "tr" ? `${ageMinutes} dk` : `${ageMinutes} min`;
  return [
    `Titan Stats — ${words.dataFresh}`,
    `${words.dataAge}: ${age}`,
    `${words.tokens}: ${formatNumber(data?.all?.tokenCount, language)}`,
    `${words.source}: titan-stats.vercel.app`,
  ].join("\n");
}

function parseCommand(text) {
  const [raw = "", ...rest] = String(text || "").trim().split(/\s+/);
  const command = raw.replace(/^\//, "").split("@")[0].toLowerCase();
  return { command, argument: rest.join(" ").trim() };
}

export async function handleTelegramUpdate(update) {
  if (!(await acceptUpdate(update?.update_id))) return { duplicate: true };
  const message = update?.message;
  if (!message?.chat?.id || !message?.text || message.from?.is_bot) return { ignored: true };

  let settings = await getOrCreateSettings(message);
  const language = settings.language || normalizeLanguage(message.from?.language_code);
  let words = TEXT[language];
  const { command, argument } = parseCommand(message.text);
  const needsData = ["campaigns", "campaign", "epoch", "wallet", "status"].includes(command);
  const data = needsData ? await fetchTitanData() : null;
  let reply = words.help;

  if (command === "start") {
    if (storageConfigured()) await saveChat(settings);
    reply = words.welcome;
  } else if (command === "help" || command === "commands") {
    reply = words.help;
  } else if (command === "campaigns") {
    reply = campaignListText(data, language);
  } else if (command === "campaign") {
    reply = argument ? campaignDetailText(data, argument, language) : words.usageCampaign;
  } else if (command === "epoch") {
    reply = epochText(data, argument.toLowerCase(), language);
  } else if (command === "wallet") {
    const name = argument || settings.follows?.[0] || "";
    reply = name ? walletText(data, name, language) : words.usageWallet;
  } else if (command === "status") {
    reply = statusText(data, language);
  } else if (command === "follow") {
    if (!storageConfigured()) reply = words.storageUnavailable;
    else if (!argument) reply = words.usageFollow;
    else {
      const clean = argument.replace(/^@/, "").trim().slice(0, 80);
      const exists = (settings.follows || []).some(name => name.toLowerCase() === clean.toLowerCase());
      if (exists) reply = words.alreadyFollowed(clean);
      else if ((settings.follows || []).length >= MAX_FOLLOWS) reply = words.followLimit;
      else {
        settings.follows = [...(settings.follows || []), clean];
        await saveChat(settings);
        reply = words.followed(clean);
      }
    }
  } else if (command === "unfollow") {
    if (!storageConfigured()) reply = words.storageUnavailable;
    else if (!argument) reply = words.usageUnfollow;
    else {
      const before = settings.follows || [];
      const after = before.filter(name => name.toLowerCase() !== argument.replace(/^@/, "").toLowerCase());
      if (after.length === before.length) reply = words.notFollowed(argument);
      else {
        settings.follows = after;
        delete settings.walletState?.[argument.toLowerCase()];
        await saveChat(settings);
        reply = words.unfollowed(argument);
      }
    }
  } else if (command === "following") {
    reply = (settings.follows || []).length
      ? `${words.followingTitle}\n\n${settings.follows.map(name => `• ${name}`).join("\n")}`
      : words.followingNone;
  } else if (command === "alerts") {
    if (!storageConfigured()) reply = words.storageUnavailable;
    else if (!["on", "off"].includes(argument.toLowerCase())) reply = words.alertsUsage;
    else {
      settings.alerts = argument.toLowerCase() === "on";
      await saveChat(settings);
      reply = settings.alerts ? words.alertsOn : words.alertsOff;
    }
  } else if (command === "lang") {
    const requested = argument.toLowerCase();
    if (!TEXT[requested]) reply = words.languageUsage;
    else {
      settings.language = requested;
      if (storageConfigured()) await saveChat(settings);
      words = TEXT[requested];
      reply = words.languageSet;
    }
  }

  await sendTelegramMessage(message.chat.id, reply);
  return { handled: true, command };
}

const EN_COMMANDS = [
  { command: "campaigns", description: "Active campaigns" },
  { command: "campaign", description: "Campaign details" },
  { command: "epoch", description: "Latest PreStocks epoch" },
  { command: "wallet", description: "Wallet/user volume" },
  { command: "follow", description: "Follow a user" },
  { command: "unfollow", description: "Stop following a user" },
  { command: "following", description: "Followed users" },
  { command: "alerts", description: "Notification settings" },
  { command: "status", description: "Live data health" },
  { command: "lang", description: "English / Türkçe" },
  { command: "help", description: "All commands" },
];

const TR_COMMANDS = [
  { command: "campaigns", description: "Aktif kampanyalar" },
  { command: "campaign", description: "Kampanya detayı" },
  { command: "epoch", description: "Son PreStocks epoch'u" },
  { command: "wallet", description: "Kullanıcı hacmi" },
  { command: "follow", description: "Kullanıcı takip et" },
  { command: "unfollow", description: "Kullanıcı takibini bırak" },
  { command: "following", description: "Takip edilenler" },
  { command: "alerts", description: "Bildirim ayarları" },
  { command: "status", description: "Canlı veri sağlığı" },
  { command: "lang", description: "English / Türkçe" },
  { command: "help", description: "Tüm komutlar" },
];

export async function ensureTelegramWebhook() {
  const target = webhookUrl();
  const info = await telegramCall("getWebhookInfo");
  if (info?.url !== target) {
    await telegramCall("setWebhook", {
      url: target,
      secret_token: webhookSecret(),
      allowed_updates: ["message"],
      drop_pending_updates: false,
      max_connections: 20,
    });
  }
  const currentCommands = await telegramCall("getMyCommands");
  if (JSON.stringify(currentCommands) !== JSON.stringify(EN_COMMANDS)) {
    await telegramCall("setMyCommands", { commands: EN_COMMANDS });
  }
  await telegramCall("setMyCommands", { commands: TR_COMMANDS, language_code: "tr" });
  const bot = await telegramCall("getMe");
  return { username: bot.username, webhook: target };
}

function buildCampaignState(data) {
  const campaigns = {};
  for (const [slug, value] of campaignEntries(data)) {
    campaigns[slug] = {
      label: campaignLabel(slug, value.meta),
      status: campaignStatus(value.meta),
      epoch: activeCampaignEpoch(value.meta),
      endTime: timestampMs(value.meta?.endTime),
    };
  }
  const epochs = numericEpochs(data);
  return {
    prestockEpoch: epochs.length ? epochs.at(-1) : null,
    campaigns,
    generatedAt: Number(data?.all?.generatedAt) || Date.now(),
  };
}

function globalEvents(previous, current, language) {
  if (!previous) return [];
  const words = TEXT[language];
  const events = [];
  if (current.prestockEpoch && previous.prestockEpoch && current.prestockEpoch > previous.prestockEpoch) {
    events.push(words.prestockEpoch(current.prestockEpoch));
  }
  for (const [slug, campaign] of Object.entries(current.campaigns)) {
    const before = previous.campaigns?.[slug];
    if (!before) {
      if (campaign.status !== "ended") events.push(words.campaignDiscovered(campaign.label));
      continue;
    }
    if (before.status !== campaign.status) {
      if (campaign.status === "live") events.push(words.campaignStarted(campaign.label));
      if (campaign.status === "ended") events.push(words.campaignEnded(campaign.label));
    }
    if (before.epoch && campaign.epoch && before.epoch !== campaign.epoch && campaign.status === "live") {
      events.push(words.epochChanged(campaign.label, before.epoch, campaign.epoch));
    }
  }
  return events;
}

function followedUserEvents(chat, data) {
  const language = chat.language || "en";
  const words = TEXT[language];
  const epoch = latestEpochKey(data);
  const nextState = {};
  const events = [];
  for (const name of chat.follows || []) {
    const metrics = walletMetrics(data, epoch, name);
    const currentRank = metrics.bestRank;
    nextState[name.toLowerCase()] = { rank: currentRank, epoch };
    const before = chat.walletState?.[name.toLowerCase()];
    if (!before?.rank || !currentRank || before.epoch !== epoch || before.rank === currentRank) continue;
    const meaningful = currentRank <= 10 || Math.abs(before.rank - currentRank) >= 5;
    if (!meaningful) continue;
    events.push(currentRank < before.rank
      ? words.rankImproved(name, before.rank, currentRank)
      : words.rankDropped(name, before.rank, currentRank));
  }
  return { events, nextState };
}

export async function runTelegramNotifications() {
  const data = await fetchTitanData();
  if (!storageConfigured()) return { storage: false, subscribers: 0, sent: 0 };
  const current = buildCampaignState(data);
  const previous = parseJson(await redisCommand("GET", stateKey), null);
  const chats = await allChats();
  let sent = 0;
  for (const chat of chats) {
    const language = chat.language === "tr" ? "tr" : "en";
    const global = chat.alerts === false ? [] : globalEvents(previous, current, language);
    const followed = followedUserEvents(chat, data);
    chat.walletState = followed.nextState;
    await saveChat(chat);
    const events = chat.alerts === false ? [] : [...global, ...followed.events];
    if (!events.length) continue;
    try {
      await sendTelegramMessage(chat.chatId, `${TEXT[language].notificationTitle}\n\n${events.join("\n\n")}`);
      sent++;
    } catch (error) {
      if (error.code === 403) await deleteChat(chat.chatId);
    }
  }
  await redisCommand("SET", stateKey, JSON.stringify(current));
  return { storage: true, subscribers: chats.length, sent, seeded: !previous };
}

function decodeBase64Url(value) {
  return Buffer.from(String(value || ""), "base64url");
}

let githubJwks = null;
let githubJwksAt = 0;

async function getGithubJwks() {
  if (githubJwks && Date.now() - githubJwksAt < 3600000) return githubJwks;
  const response = await fetch(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`);
  if (!response.ok) throw new Error("GitHub JWKS unavailable");
  githubJwks = await response.json();
  githubJwksAt = Date.now();
  return githubJwks;
}

export async function verifySchedulerAuthorization(authorization) {
  const bearer = String(authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  if (process.env.CRON_SECRET && safeEqual(bearer, process.env.CRON_SECRET)) return true;
  const parts = bearer.split(".");
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(decodeBase64Url(parts[0]).toString("utf8"));
    const claims = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== GITHUB_OIDC_ISSUER || !audience.includes(GITHUB_OIDC_AUDIENCE)) return false;
    if (claims.repository !== GITHUB_REPOSITORY || claims.ref !== "refs/heads/main") return false;
    if (!String(claims.workflow_ref || "").includes(`${GITHUB_WORKFLOW}@refs/heads/main`)) return false;
    if (Number(claims.exp) <= now || Number(claims.nbf || 0) > now + 30) return false;
    const jwks = await getGithubJwks();
    const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === "RSA");
    if (!jwk || header.alg !== "RS256") return false;
    const key = await webcrypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return webcrypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64Url(parts[2]),
      Buffer.from(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    return false;
  }
}
