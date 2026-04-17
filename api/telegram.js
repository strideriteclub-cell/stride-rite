const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
function generateUUID() { return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); }
const BOT_TOKEN = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
const ADMIN_CHAT_ID = '1538316434';
const SITE_URL = 'https://stride-rite.vercel.app';

const dbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

function calculateAge(birthdate) {
    if (!birthdate) return '?';
    const birth = new Date(birthdate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
}
function formatTime(time) {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(m).padStart(2,'0')} ${ampm}`;
}

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
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(data)
    });
}

async function getSession() {
    const rows = await dbGet('bot_sessions', 'id=eq.admin');
    return rows && rows.length > 0 ? rows[0] : { state: 'idle', data: {} };
}
async function setSession(state, data = {}) {
    await dbUpsert('bot_sessions', { id: 'admin', state, data, updated_at: new Date().toISOString() });
}
async function clearSession() { await setSession('idle', {}); }

async function sendMessage(chatId, text, replyMarkup = null) {
    const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
}
async function answerCallbackQuery(id) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: id })
    });
}

async function checkBirthdays(chatId) {
    const users = await dbGet('stride_users');
    const now = new Date();
    const soon = (users || []).filter(u => {
        if (!u.birthdate) return false;
        const b = new Date(u.birthdate);
        const daysUntil = Math.ceil((new Date(now.getFullYear(), b.getMonth(), b.getDate()) - now) / 86400000);
        return daysUntil >= 0 && daysUntil <= 7;
    });
    if (soon.length > 0) {
        const lines = soon.map(u => {
            const b = new Date(u.birthdate);
            const daysUntil = Math.ceil((new Date(now.getFullYear(), b.getMonth(), b.getDate()) - now) / 86400000);
            const label = daysUntil === 0 ? '🎂 TODAY!' : `in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`;
            return `• *${u.name}* — ${label} (turning ${calculateAge(u.birthdate) + (daysUntil === 0 ? 0 : 1)})`;
        }).join('\n');
        await sendMessage(chatId, `🎂 *Upcoming Birthdays (next 7 days):*\n\n${lines}`);
    } else {
        await sendMessage(chatId, "🎂 No upcoming birthdays.");
    }
}

async function sendMenu(chatId, msg = "🏠 *Stride Rite Admin V4*\nWhat would you like to manage?") {
    const replyMarkup = {
        inline_keyboard: [
            [{ text: "📊 Run Stats", callback_data: "cmd_stats" }, { text: "📋 List All Runs", callback_data: "cmd_runs" }],
            [{ text: "📥 Export Excel", callback_data: "cmd_export" }, { text: "📲 WhatsApp Blast", callback_data: "cmd_blast" }],
            [{ text: "📝 Survey Link", callback_data: "cmd_survey" }, { text: "🎂 Birthdays", callback_data: "cmd_birthdays" }],
            [{ text: "🔍 Runner Lookup", callback_data: "cmd_lookup_start" }, { text: "📣 Broadcast", callback_data: "cmd_broadcast_start" }],
            [{ text: "📈 Growth Graph", callback_data: "cmd_growth" }, { text: "✏️ Edit a Run", callback_data: "cmd_edit_list" }],
            [{ text: "📸 Add to Gallery", callback_data: "cmd_gallery_start" }, { text: "🛍️ VIP Shop Admin", callback_data: "cmd_shop_menu" }],
            [{ text: "🚫 Cancel a Run", callback_data: "cmd_cancel_list" }, { text: "🗑️ Delete a Run", callback_data: "cmd_delete_list" }],
            [{ text: "🆕 Create New Run ", callback_data: "create_step1" }]
        ]
    };
    await sendMessage(chatId, msg, replyMarkup);
}

async function handleGalleryStart(chatId) {
    const runs = await dbGet('stride_runs');
    const buttons = (runs || []).map(r => {
        const label = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        return [{ text: `🏃 ${label}`, callback_data: `gallery_run_${encodeURIComponent(label)}` }];
    });
    buttons.unshift([{ text: "📸 General Photo", callback_data: "gallery_run_general" }]);
    buttons.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "📸 *Gallery Upload*", { inline_keyboard: buttons });
}

async function handleShopMenu(chatId) {
    const settings = await dbGet('shop_settings');
    const isShopOpen = (settings && settings.length > 0) ? settings[0].is_open : false;
    const orders = await dbGet('shop_orders', 'status=eq.pending');
    await sendMessage(chatId, `🛍️ *VIP Shop Admin*\n\nStatus: ${isShopOpen ? '🟢 OPEN' : '🔴 CLOSED'}\nPending: ${orders ? orders.length : 0}`, {
        inline_keyboard: [
            [{ text: isShopOpen ? "🔴 Hide Shop" : "🟢 Open Shop", callback_data: `shop_toggle_${!isShopOpen}` }],
            [{ text: "📦 Export Orders", callback_data: "cmd_shop_export" }],
            [{ text: "↩️ Back", callback_data: "cmd_menu" }]
        ]
    });
}

async function createStep1(chatId) {
    await clearSession();
    const amHours = [4,5,6,7,8,9,10,11].map(h => ({ text: `${h} AM`, callback_data: `create_hour_${String(h).padStart(2,'0')}` }));
    const pmHours = [12,1,2,3,4,5,6,7,8,9,10,11].map(h => ({ text: `${h} PM`, callback_data: `create_hour_${String(h === 12 ? 12 : h+12).padStart(2,'0')}` }));
    const rows = [];
    for (let i = 0; i < amHours.length; i += 4) rows.push(amHours.slice(i, i+4));
    for (let i = 0; i < pmHours.length; i += 4) rows.push(pmHours.slice(i, i+4));
    rows.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🆕 *Create Run (Step 1/5)*\n\n⏰ Select hour:", { inline_keyboard: rows });
}

export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(200).send('Alive'); return; }
    try {
        const body = req.body;
        if (body.callback_query) {
            const cq = body.callback_query;
            const chatId = cq.message.chat.id.toString();
            if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
            await answerCallbackQuery(cq.id);
            const data = cq.data;
            if (data === 'cmd_menu') await sendMenu(chatId);
            else if (data === 'cmd_stats') await handleStats(chatId);
            else if (data === 'cmd_runs') await handleListRuns(chatId);
            else if (data === 'cmd_export') await handleExport(chatId);
            else if (data === 'cmd_blast') await handleBlast(chatId);
            else if (data === 'cmd_survey') await handleSurvey(chatId);
            else if (data === 'cmd_birthdays') await checkBirthdays(chatId);
            else if (data === 'cmd_growth') await handleGrowthGraph(chatId);
            else if (data === 'cmd_lookup_start') await handleLookupStart(chatId);
            else if (data === 'cmd_broadcast_start') await handleBroadcastStart(chatId);
            else if (data === 'create_step1') await createStep1(chatId);
            else if (data === 'cmd_shop_menu') await handleShopMenu(chatId);
            res.status(200).send('ok'); return;
        }

        if (!body.message || !body.message.text) { res.status(200).send('ok'); return; }
        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
        const text = body.message.text.trim();
        const cmd = text.toLowerCase();
        if (cmd === '/start' || cmd === '/menu') await sendMenu(chatId);
        res.status(200).send('ok');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
}
