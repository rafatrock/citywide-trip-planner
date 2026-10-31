// Thin wrapper around the Telegram Bot API (free; no SDK needed).

import { countFetch } from './db.js';

export async function tg(env, method, body) {
  countFetch(env);
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!data.ok) console.log('telegram error', method, data.description || res.status);
  return data;
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function send(env, chatId, text, keyboard, extra = {}) {
  return tg(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    ...extra,
  });
}

// Airline logos from Aviasales (pics.avs.io/width/height/IATA.png). Telegram can't put images inside
// text, so the logo is shown as the message's small link preview, above the text.
export const logoUrl = (code) => (code && /^[A-Z0-9]{2}$/.test(code) ? `https://pics.avs.io/120/120/${code}.png` : null);
export const logoLink = (code) => (logoUrl(code) ? `<a href="${logoUrl(code)}">\u200d</a>` : '');
export const logoPreview = (code) => (logoUrl(code)
  ? { link_preview_options: { url: logoUrl(code), prefer_small_media: true, show_above_text: true } }
  : {});

export function edit(env, chatId, messageId, text, keyboard) {
  return tg(env, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  });
}

export function answer(env, callbackId, text) {
  return tg(env, 'answerCallbackQuery', { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

export function typing(env, chatId) {
  return tg(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });
}

// Button helpers. Telegram limits callback_data to 64 bytes.
export const btn = (text, data) => ({ text, callback_data: String(data).slice(0, 64) });
export const url = (text, href) => ({ text, url: href });
export const rows = (buttons, perRow = 2) => {
  const out = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
};
