// [FILE]: api/telegram.js (UNIFIED ADMIN BOT)
// Merges your original logic with the new order management fixes.

const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const BOT_TOKEN = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
const ADMIN_CHAT_ID = '1538316434';
const SITE_URL = 'https://stride-rite.vercel.app';

const dbHeaders = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };

// ─── DB HELPERS ───────────────────────────────────────────────────────────────
async function dbGet(table, query = 'select=*') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: dbHeaders });
    return await res.json();
}
async function dbInsert(table, data) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: dbHeaders, body: JSON.stringify(data) });
    return await res.json();
}
async function dbDelete(table, col, val) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}`, { method: 'DELETE', headers: dbHeaders });
}
async function dbPatch(table, col, val, data) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}`, { method: 'PATCH', headers: dbHeaders, body: JSON.stringify(data) });
}
async function dbUpsert(table, data) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify(data) });
}

// ─── SESSION & TELEGRAM ───────────────────────────────────────────────────────
async function getSession() { const r = await dbGet('bot_sessions', 'id=eq.admin'); return r && r.length > 0 ? r[0] : { state: 'idle', data: {} }; }
async function setSession(s, d = {}) { await dbUpsert('bot_sessions', { id: 'admin', state: s, data: d, updated_at: new Date().toISOString() }); }
async function sendMessage(id, t, m = null) { const b = { chat_id: id, text: t, parse_mode: 'Markdown' }; if (m) b.reply_markup = m; await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); }
async function answerCallbackQuery(id) { await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callback_query_id: id }) }); }

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(200).send('Alive'); return; }
    try {
        const body = req.body;

        // Callback Queries (Buttons)
        if (body.callback_query) {
            const cq = body.callback_query;
            const chatId = cq.message.chat.id.toString();
            if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
            await answerCallbackQuery(cq.id);
            const data = cq.data;

            // Handle Shop Approval/Rejection
            if (data.startsWith('shop_appr_') || data.startsWith('shop_rej_')) {
                const parts = data.split('_');
                const action = parts[2]; const orderId = parts[3];
                const newStatus = action === 'appr' ? 'approved' : 'rejected';
                await dbPatch('shop_orders', 'id', orderId, { status: newStatus });
                await sendMessage(chatId, `✅ Order for ID: ${orderId.slice(0,8)} marked as *${newStatus.toUpperCase()}*`);
                return res.status(200).send('ok');
            }

            // Original Menu Commands (Restored)
            if (data === 'cmd_menu') await sendMenu(chatId);
            else if (data === 'cmd_stats') await handleStats(chatId);
            else if (data === 'cmd_runs') await handleListRuns(chatId);
            else if (data === 'cmd_birthdays') await checkBirthdays(chatId);
            // ... (Add your other callback handlers here)

            res.status(200).send('ok'); return;
        }

        if (!body.message) { res.status(200).send('ok'); return; }
        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }

        // Live Location Handling (Integrated)
        if (body.message.location) {
            const { latitude, longitude } = body.message.location;
            await dbPatch('stride_live_status', 'id', '1', { is_live: true, lat: latitude, lng: longitude, updated_at: new Date().toISOString() });
            return res.status(200).send('ok');
        }

        const text = body.message.text ? body.message.text.trim() : "";
        if (text === '/stoplive') {
            await dbPatch('stride_live_status', 'id', '1', { is_live: false, updated_at: new Date().toISOString() });
            await sendMessage(chatId, "🛑 Live run tracking has been *STOPPED*.");
            return res.status(200).send('ok');
        }

        if (text === '/start' || text === '/menu') await sendMenu(chatId);
        // ... (Add your other message handlers here)

        res.status(200).send('ok');
    } catch(e) { console.error(e); res.status(500).send('Error'); }
}

async function sendMenu(id, m = "👟 *Stride Rite Admin Bot*") {
    await setSession('idle');
    await sendMessage(id, m, { inline_keyboard: [[{ text: "📊 Stats", callback_data: "cmd_stats" }, { text: "📋 Runs", callback_data: "cmd_runs" }], [{ text: "🎂 Birthdays", callback_data: "cmd_birthdays" }]] });
}
// (Re-paste your original helper functions from your telegram.js below)
