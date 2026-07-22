import {
  ensureTelegramWebhook,
  runTelegramNotifications,
  storageConfigured,
  telegramConfigured,
  verifySchedulerAuthorization,
} from "../lib/telegram.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!(await verifySchedulerAuthorization(req.headers.authorization))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!telegramConfigured()) {
    return res.status(200).json({ ok: true, configured: false, storage: storageConfigured() });
  }

  try {
    const bot = await ensureTelegramWebhook();
    const notifications = await runTelegramNotifications();
    return res.status(200).json({ ok: true, configured: true, bot: bot.username, ...notifications });
  } catch (error) {
    console.error("Telegram cron failed", error?.message || "unknown error");
    return res.status(502).json({ error: "Telegram automation failed" });
  }
}
