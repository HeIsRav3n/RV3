'use strict';

const config = require('../config');

async function discord(title, body) {
  const url = config.discordWebhook;
  if (!url?.startsWith('https://discord.com/api/webhooks')) return false;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{ title, description: body, color: 0x4a7cfc, timestamp: new Date().toISOString() }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  return true;
}

async function telegram(text) {
  if (!config.telegramToken || !config.telegramChatId) return false;
  const url = `https://api.telegram.org/bot${config.telegramToken}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(8000),
  });
  return true;
}

async function send(title, body) {
  const results = { discord: false, telegram: false };
  try { results.discord = await discord(title, body); } catch { /* */ }
  try { results.telegram = await telegram(`<b>${title}</b>\n${body}`); } catch { /* */ }
  return results;
}

module.exports = { send, discord, telegram };
