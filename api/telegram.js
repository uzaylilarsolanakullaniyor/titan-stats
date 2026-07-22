import {
  handleTelegramUpdate,
  safeEqual,
  storageConfigured,
  telegramConfigured,
  webhookSecret,
} from "../lib/telegram.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json({
      service: "Titan Stats Telegram",
      configured: telegramConfigured(),
      storage: storageConfigured(),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!telegramConfigured()) return res.status(503).json({ error: "Bot is not configured" });
  const receivedSecret = req.headers["x-telegram-bot-api-secret-token"];
  if (!safeEqual(receivedSecret, webhookSecret())) return res.status(401).json({ error: "Unauthorized" });

  try {
    await handleTelegramUpdate(req.body || {});
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Telegram update failed", error?.message || "unknown error");
    return res.status(200).json({ ok: true });
  }
}
