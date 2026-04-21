const crypto = require('crypto');
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const BOT_TOKEN = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
const ADMIN_CHAT_ID = '1538316434';
const SITE_URL = 'https://stride-rite.vercel.app';
// USE ENVIRONMENT VARIABLE FOR KEY PROTECTION
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyAnJxWoxjwLYsr2Tw3GDM7FVf7VCXrMzJs';

const dbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

function esc(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}


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
    return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function extractIsoDate(dateLabel) {
    if (!dateLabel || !dateLabel.includes('||')) return null;
    return dateLabel.split('||')[1];
}

function getRunTitleStr(r) {
    const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
    if (r.tour_stop_id) {
        return `Stop ${r.tour_stop_id} ${r.tour_stop_name || r.location || 'Tour'} Run`;
    }
    return null;
}

function formatRunLabelShort(r) {
    const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
    let t = getRunTitleStr(r);
    return t ? `${t} - ${dt}` : dt;
}

function formatRunLabelMultiline(r) {
    const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
    let t = getRunTitleStr(r);
    return t ? `*${t}*\n📍 ${dt}` : `📍 ${dt}`;
}

async function getSortedUpcomingRuns() {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) return [];

    const now = new Date().toISOString();

    return runs
        .filter(r => {
            const isoDate = extractIsoDate(r.date_label);
            return isoDate && isoDate >= now;
        })
        .sort((a, b) => {
            const dateA = extractIsoDate(a.date_label);
            const dateB = extractIsoDate(b.date_label);
            return dateA.localeCompare(dateB);
        });
}

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
    await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}`, {
        method: 'PATCH', headers: dbHeaders, body: JSON.stringify(data)
    });
}
async function dbUpsert(table, data) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(data)
    });
}

async function resolveCoordinates(input) {
    if (!input) return null;
    const text = input.trim();
    
    // 1. Direct Lat/Lng (e.g. "30.065, 31.504")
    const directMatch = text.match(/^(-?\d+\.\d+),\s*(-?\d+\.\d+)$/);
    if (directMatch) return { lat: parseFloat(directMatch[1]), lng: parseFloat(directMatch[2]) };

    // 2. Google Maps URLs (including shortlinks)
    if (text.includes('maps.app.goo.gl') || text.includes('google.com/maps')) {
        try {
            const res = await fetch(text, { redirect: 'follow' });
            const finalUrl = res.url;
            
            // Try extracting from @lat,lng format
            const atMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
            
            // Try extracting from query params (ll or q)
            const urlObj = new URL(finalUrl);
            const ll = urlObj.searchParams.get('ll') || urlObj.searchParams.get('q');
            if (ll && ll.includes(',')) {
                const parts = ll.split(',');
                return { lat: parseFloat(parts[0]), lng: parseFloat(parts[1]) };
            }
        } catch (e) {
            console.error("Coords resolution error:", e);
        }
    }
    return null;
}

// ─── SESSION ──────────────────────────────────────────────────────────────────
async function getSession() {
    const rows = await dbGet('bot_sessions', 'id=eq.admin');
    return rows && rows.length > 0 ? rows[0] : { state: 'idle', data: {} };
}
async function setSession(state, data = {}) {
    await dbUpsert('bot_sessions', { id: 'admin', state, data, updated_at: new Date().toISOString() });
}
async function clearSession() { await setSession('idle', {}); }

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
async function sendMessage(chatId, text, replyMarkup = null) {
    const body = { chat_id: chatId, text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Telegram API Error (sendMessage): ${data.description}`);
    return data.result;
}
async function editMessage(chatId, messageId, text, replyMarkup = null) {
    const body = { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return (await res.json()).result;
}
async function answerCallbackQuery(id) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: id })
    });
    if (!res.ok) {
        const err = await res.json();
        console.error("answerCallbackQuery fail:", err);
    }
}
async function sendDocument(chatId, content, filename) {
    const boundary = '----Boundary12345';
    let body = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
        method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body
    });
}

// ─── AI MISSION STRATEGIST ──────────────────────────────────────────────────
async function getDBContext() {
    try {
        const [users, runs, regs, items, orders, surveys, stops] = await Promise.all([
            dbGet('stride_users'),
            dbGet('stride_runs'),
            dbGet('stride_registrations'),
            dbGet('shop_items'),
            dbGet('shop_orders'),
            dbGet('stride_surveys'),
            dbGet('stride_tour_stops')
        ]);

        const upcoming = (runs || []).filter(r => {
            const iso = extractIsoDate(r.date_label);
            return iso && iso >= new Date().toISOString();
        });

        // Optimized Summary (smaller payload to avoid Gemini timeouts)
        return `
DATABASE SUMMARY:
- Total Runners: ${(users || []).length}
- Active Missions (Upcoming): ${upcoming.length}
- Total Registrations: ${(regs || []).length} (Verified Scans: ${(regs || []).filter(r => r.attended_at).length})
- VIP Shop items: ${(items || []).filter(i => i.is_active).length}
- Pending Shop Orders: ${(orders || []).filter(o => o.status === 'pending').length}
- Recent Feedback Score: ${(surveys || []).length > 0 ? ((surveys || []).reduce((s,a) => s + a.rating, 0) / (surveys || []).length).toFixed(1) : 'N/A'}/10

UPCOMING MISSIONS:
${upcoming.map(r => `• ${r.tour_stop_name || r.location} (${r.date_label.split('||')[0]}) - ${(regs || []).filter(reg => reg.run_id === r.id).length} registered`).join('\n')}

LATEST FEEDBACK:
${(surveys || []).slice(0, 3).map(s => `• [${s.run_label}] Rating: ${s.rating}, Comment: ${s.feedback}`).join('\n')}
`;
    } catch (e) { return "Error gathering DB summary: " + e.message; }
}

async function askGemini(chatId, prompt, history = []) {
    try {
        const dbContext = await getDBContext();
        const systemPrompt = `You are the Stride Rite Community Advisor. 
You are a helpful, friendly, and supportive partner to Haleem, the founder of Stride Rite.
Current Community Data:
${dbContext}

Your goal:
1. Talk to Haleem like a close teammate. Be casual, positive, and clear.
2. Use lots of emojis (like 👟, 🏃‍♂️, 📈, 🛍️, ✨, 🙌) to make the chat feel alive and fun.
3. Avoid using "###" or too many markdown symbols (stars, hashes, bold headers). Keep the layout clean and easy to scan.
4. Help him understand how the community is doing (runners, missions, shop stuff).
5. If you see something interesting in the data (like a growth trend), mention it in a simple way.
6. Keep your answers friendly, visual (with emojis), and very easy to read.

Current Chat History:
${history.map(h => `${h.role === 'user' ? 'Haleem' : 'You'}: ${h.text}`).join('\n')}
Haleem: ${prompt}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'x-goog-api-key': GEMINI_API_KEY
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }]
            })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        return data.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error("Gemini Error:", e);
        return `⚠️ <b>AI Connection Error:</b> ${e.message}\n\nPlease check your Gemini API key or try again in a moment.`;
    }
}

async function handleAIStart(chatId) {
    await sendMessage(chatId, "⏳ <b>Strategic Analysis in progress...</b>\nEstablishing neuro-link with Stride Rite database...");
    
    // Proactive Summary
    const initialPrompt = "Haleem just opened the AI strategist. Give him a high-energy 'State of the Union' summary. Mention specifically how many missions are upcoming, pending shop orders, and any interesting trends in feedback or runner growth. Keep it tactical.";
    const response = await askGemini(chatId, initialPrompt);
    
    await setSession('chatting_with_ai', { history: [{ role: 'ai', text: response }] });
    await sendMessage(chatId, response, {
        inline_keyboard: [[{ text: "↩️ Exit Strategist", callback_data: "cmd_menu" }]]
    });
}

// ─── BIRTHDAY CHECK ───────────────────────────────────────────────────────────
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
        await sendMessage(chatId, "🎂 No upcoming birthdays in the next 7 days.");
    }
}


// ─── MENU ─────────────────────────────────────────────────────────────────────
async function sendMenu(chatId, msg) {
    await clearSession();
    const bibEnabled = await getBibScanEnabled();
    const defaultMsg = `👟 <b>Stride Rite Admin Bot</b>\n\nHey Haleem! Your AI Bib Scanner is currently ${bibEnabled ? '<b>🔵 ACTIVE</b>' : '<b>⚫ STANDBY</b>'}.\n\n<i>Last Sync: ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</i>`;
    
    await sendMessage(chatId, msg || defaultMsg, {
        inline_keyboard: [
            [{ text: "📊 Run Stats", callback_data: "cmd_stats" }, { text: "📋 List All Runs", callback_data: "cmd_runs" }],
            [{ text: "📸 Add to Gallery", callback_data: "cmd_gallery_start" }, { text: "🛍️ VIP Shop Admin", callback_data: "cmd_shop_menu" }],
            [{ text: "📥 Export Excel", callback_data: "cmd_export" }, { text: bibEnabled ? "🔵 Bib Scanner: ON" : "⚫ Bib Scanner: OFF", callback_data: "gal_toggle_bib_menu" }],
            [{ text: "📲 WhatsApp Blast", callback_data: "cmd_blast" }, { text: "🤖 AI Strategist", callback_data: "cmd_ai_strat" }],
            [{ text: "📝 Feedbacks", callback_data: "cmd_survey_menu" }, { text: "🎂 Birthdays", callback_data: "cmd_birthdays" }],
            [{ text: "🔍 Runner Lookup", callback_data: "cmd_lookup_start" }, { text: "📣 Broadcast", callback_data: "cmd_broadcast_start" }],
            [{ text: "📈 Growth Graph", callback_data: "cmd_growth" }, { text: "✏️ Edit a Run", callback_data: "cmd_edit_list" }],
            [{ text: "🛠️ Tour Admin", callback_data: "cmd_tour_admin" }, { text: "🆕 Create New Run", callback_data: "create_setup_start" }],
            [{ text: "🧪 Test Center", callback_data: "cmd_test_center" }, { text: "🚫 Cancel a Run", callback_data: "cmd_cancel_list" }],
            [{ text: "🗑️ Delete a Run", callback_data: "cmd_delete_list" }]
        ]
    });
}

// ─── TOUR EDITOR ─────────────────────────────────────────────────────────────
async function handleTourEditorStart(chatId) {
    const stops = await dbGet('stride_tour_stops');
    if (!stops || stops.length === 0) { await sendMessage(chatId, "❌ No tour stops found in database."); return; }
    
    // Sort array safely
    const sortedStops = stops.sort((a,b) => a.id - b.id);
    const rows = [];
    for (let i = 0; i < sortedStops.length; i += 2) {
        const batch = sortedStops.slice(i, i+2);
        rows.push(batch.map(s => ({ text: `Stop ${s.id}: ${s.name}`, callback_data: `tour_edit_pick_${s.id}` })));
    }
    rows.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);

    await sendMessage(chatId, "🗺️ *Tour Map Editor*\n\nWhich Stop do you want to modify on the Dashboard Map?", { inline_keyboard: rows });
}

async function handleTourEditorPick(chatId, stopId) {
    const stopRes = await dbGet('stride_tour_stops', `id=eq.${stopId}`);
    if (!stopRes || stopRes.length === 0) return;
    const stop = stopRes[0];
    
    await setSession('tour_edit_action', { stopId });
    await sendMessage(chatId, `🗺️ *Editing Stop ${stop.id}*\n\n*Current Name:* ${stop.name}\n*Location:* ${stop.lat}, ${stop.lng}\n\nWhat do you want to change?`, {
        inline_keyboard: [
            [{ text: "✏️ Change Name", callback_data: `tour_edit_name_${stop.id}` }],
            [{ text: "📍 Change Location", callback_data: `tour_edit_loc_${stop.id}` }],
            [{ text: "↩️ Back", callback_data: "cmd_tour_editor" }]
        ]
    });
}

async function handleTourEditorWaitName(chatId, stopId) {
    await setSession('tour_edit_waiting_name', { stopId });
    await sendMessage(chatId, `✏️ *Type the new name for Stop ${stopId}:*`);
}

async function handleTourEditorWaitLoc(chatId, stopId) {
    await setSession('tour_edit_waiting_loc', { stopId });
    await sendMessage(chatId, `📍 *Type/paste the Google Maps link for Stop ${stopId}:*`);
}

// ─── TOUR ADMIN SUBMENU ───────────────────────────────────────────────────────
async function handleTourAdmin(chatId) {
    await sendMessage(chatId, `🛠️ <b>Tour Admin Center</b>\n\nManage the entire Tour de Cairo season from here.`, {
        inline_keyboard: [
            [{ text: "🗺️ Edit Stop Names & Locations", callback_data: "cmd_tour_editor" }],
            [{ text: "✨ Auto-Create New Season", callback_data: "tour_new_season" }],
            [{ text: "🗑️ Delete ALL Tour Runs (Season Reset)", callback_data: "tour_delete_all_confirm" }],
            [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]
        ]
    });
}

// ─── DELETE ALL TOUR RUNS ─────────────────────────────────────────────────────
async function handleTourDeleteAllConfirm(chatId) {
    const allRuns = await dbGet('stride_runs', 'select=id,tour_stop_id');
    const count = (allRuns || []).filter(r => r.tour_stop_id !== null && r.tour_stop_id !== undefined).length;
    await sendMessage(chatId,
        `⚠️ <b>DANGER ZONE — Season Reset</b>\n\nYou are about to permanently delete <b>${count} Tour Run${count !== 1 ? 's' : ''}</b> and <b>all their registrations</b>.\n\n<i>This cannot be undone. Only do this at the end of a season to clean up before the next one.</i>`,
        {
            inline_keyboard: [
                [{ text: `🗑️ YES — Delete All ${count} Tour Runs`, callback_data: "tour_delete_all_yes" }],
                [{ text: "❌ No, Take Me Back", callback_data: "cmd_tour_admin" }]
            ]
        }
    );
}

async function handleTourDeleteAllExecute(chatId) {
    await sendMessage(chatId, "⏳ <b>Deleting all tour runs and registrations...</b>");
    const allRuns = await dbGet('stride_runs', 'select=id,tour_stop_id');
    const tourRuns = (allRuns || []).filter(r => r.tour_stop_id !== null && r.tour_stop_id !== undefined);
    let deleted = 0;
    for (const run of tourRuns) {
        await dbDelete('stride_registrations', 'run_id', run.id);
        await dbDelete('stride_runs', 'id', run.id);
        deleted++;
    }
    await sendMessage(chatId,
        `✅ <b>Season Reset Complete!</b>\n\n🗑️ Removed ${deleted} tour run${deleted !== 1 ? 's' : ''} and all their registrations.\n\n<i>Dashboard is clean and ready for the next season!</i>`,
        {
            inline_keyboard: [
                [{ text: "✨ Create New Season", callback_data: "tour_new_season" }],
                [{ text: "↩️ Back", callback_data: "cmd_tour_admin" }]
            ]
        }
    );
}

// ─── AUTO-CREATE NEW SEASON ───────────────────────────────────────────────────
async function handleTourNewSeasonStart(chatId) {
    await setSession('tour_season_waiting_date', {});
    await sendMessage(chatId,
        `✨ <b>Auto-Create New Season</b>\n\n<b>Step 1/2 — Start Date</b>\n\nSend me the date of <b>Stop 1</b> (the first run of the season).\n\nFormat: <code>YYYY-MM-DD</code>\nExample: <code>2026-05-02</code>`
    );
}

async function handleTourSeasonDate(chatId, text) {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(text.trim())) {
        await sendMessage(chatId, "❌ Invalid format. Please send the date as <code>YYYY-MM-DD</code>\nExample: <code>2026-05-02</code>");
        return;
    }
    await setSession('tour_season_waiting_time', { startDate: text.trim() });
    await sendMessage(chatId,
        `✅ <b>Date saved: ${esc(text.trim())}</b>\n\n<b>Step 2/2 — Start Time</b>\n\nWhat time should all 8 runs start?\n\nFormat: <code>HH:MM</code>\nExample: <code>06:00</code>`
    );
}

async function handleTourSeasonTime(chatId, text) {
    const session = await getSession();
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(text.trim())) {
        await sendMessage(chatId, "❌ Invalid format. Please send the time as <code>HH:MM</code>\nExample: <code>06:00</code>");
        return;
    }
    const startDate = session.data.startDate;
    const startTime = text.trim();
    const baseDate = new Date(`${startDate}T${startTime}:00`);
    let preview = `✨ <b>New Season Preview</b>\n\nHere are the 8 stops I'll create:\n\n`;
    for (let i = 0; i < 8; i++) {
        const d = new Date(baseDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        const fd = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        preview += `🏁 <b>Stop ${i + 1}</b> — ${fd} at ${formatTime(startTime)}\n`;
    }
    preview += `\n<i>Tap ✅ to create all 8 runs instantly!</i>`;
    await setSession('tour_season_confirming', { startDate, startTime });
    await sendMessage(chatId, preview, {
        inline_keyboard: [
            [{ text: "✅ Create All 8 Stops!", callback_data: "tour_season_confirm_yes" }],
            [{ text: "❌ Cancel", callback_data: "cmd_tour_admin" }]
        ]
    });
}

async function handleTourSeasonExecute(chatId) {
    const session = await getSession();
    const { startDate, startTime } = session.data;

    // Validate session data before doing anything
    if (!startDate || !startTime) {
        await sendMessage(chatId, `❌ <b>Session Error</b>\n\nCouldn't read the date/time.\nDebug: <code>${JSON.stringify(session.data)}</code>\n\nPlease start again from Tour Admin → Auto-Create New Season.`);
        return;
    }

    const baseDate = new Date(`${startDate}T${startTime}:00`);
    if (isNaN(baseDate.getTime())) {
        await sendMessage(chatId, `❌ <b>Invalid Date</b>: <code>${startDate}T${startTime}:00</code>\n\nPlease use <code>YYYY-MM-DD</code> format for date and <code>HH:MM</code> for time.`);
        return;
    }

    await sendMessage(chatId, `⏳ <b>Creating all 8 tour stops...</b>\n<i>Start: ${startDate} at ${startTime}</i>`);
    const tourStops = await dbGet('stride_tour_stops');
    const stopsMap = {};
    (tourStops || []).forEach(s => { stopsMap[s.id] = s.name; });
    let created = 0;
    let lastError = '';
    for (let i = 0; i < 8; i++) {
        const stopNum = i + 1;
        const d = new Date(baseDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
        const fd = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const stopName = stopsMap[stopNum] || `Stop ${stopNum}`;
        try {
            const result = await dbInsert('stride_runs', {
                id: crypto.randomUUID(),
                date_label: `${fd} - ${formatTime(startTime)}||${d.toISOString()}`,
                location: stopName,
                location_link: '',
                description: 'Every pace is welcome!',
                created_by: 'admin-1',
                route_preview_url: null,
                route_type: 'image',
                tour_stop_id: stopNum,
                tour_stop_name: stopName,
                partner_name: null,
                partner_ig: null,
                partner_logo: null
            });
            // Success: array returned, or truthy without error fields
            if (Array.isArray(result) || (result && !result.message && !result.error && !result.code)) {
                created++;
            } else {
                lastError = result ? (result.message || result.error || result.code || JSON.stringify(result)) : 'null response';
                console.error(`Stop ${stopNum} failed:`, lastError);
                break; // stop on first error so we can see it clearly
            }
        } catch (e) {
            lastError = e.message;
            break;
        }
    }
    await clearSession();
    if (created < 8) {
        await sendMessage(chatId, `⚠️ <b>Season Creation Failed</b>\n\n✅ ${created}/8 stops created\n❌ <b>Error:</b> <code>${esc(lastError)}</code>`);
        return;
    }
    await sendMessage(chatId,
        `🎉 <b>New Season is Live!</b>\n\n✅ All 8 tour runs added to your dashboard!\n\n<i>Use the Tour Map Editor to update stop locations, and Edit a Run to add Maps links.</i>`,
        {
            inline_keyboard: [
                [{ text: "🗺️ Open Tour Map Editor", callback_data: "cmd_tour_editor" }],
                [{ text: "↩️ Back to Tour Admin", callback_data: "cmd_tour_admin" }]
            ]
        }
    );
}

// ─── TEST CENTER ──────────────────────────────────────────────────────────────
async function handleTestCenter(chatId) {
    const tests = await dbGet('stride_tests', 'select=*&order=created_at.desc');
    const rows = [];
    if (tests && tests.length > 0) {
        for (const t of tests) {
            rows.push([
                { text: `🔗 ${t.name}`, url: t.url },
                { text: `🗑️ Delete`, callback_data: `test_del_${t.id}` }
            ]);
        }
    }
    rows.push([{ text: "➕ Add New Test Link", callback_data: "test_add" }]);
    rows.push([{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]);
    const count = tests ? tests.length : 0;
    await sendMessage(chatId,
        `🧪 <b>Test Center</b>\n\n${count > 0 ? `You have <b>${count}</b> saved test${count > 1 ? 's' : ''}. Tap any link to open it.` : 'No tests saved yet. Tap ➕ to add your first one!'}`,
        { inline_keyboard: rows }
    );
}

async function handleTestAdd(chatId) {
    await setSession('test_waiting_name', {});
    await sendMessage(chatId, `🧪 <b>Add New Test — Step 1/2</b>\n\nWhat should I call this test?\n\nExample: <code>Registration Flow v2</code>`);
}

async function handleTestDelete(chatId, testId) {
    const testRes = await dbGet('stride_tests', `id=eq.${testId}`);
    if (!testRes || testRes.length === 0) {
        await sendMessage(chatId, "❌ Test not found.");
        await handleTestCenter(chatId);
        return;
    }
    const test = testRes[0];
    await dbDelete('stride_tests', 'id', testId);
    await sendMessage(chatId, `✅ <b>"${esc(test.name)}"</b> has been deleted.`);
    await handleTestCenter(chatId);
}

async function resolveGoogleMapsLink(url) {
    try {
        // --- Pattern 1: Standard URL with @lat,lng (e.g. google.com/maps/place/...@30.123,31.456,17z)
        let match = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };

        // --- Pattern 2: query param ?q=lat,lng or &q=lat,lng
        match = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };

        // --- Pattern 3: ll=lat,lng
        match = url.match(/ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };

        // --- Pattern 4: Encoded in path !3dlat!4dlng (Google Maps embed format)
        match = url.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
        if (match) return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };

        // --- Fallback: Follow redirect (for short links like maps.app.goo.gl or goo.gl/maps/...)
        const resFollow = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0' } });
        const finalUrl = resFollow.url;
        
        // Try all patterns again on the expanded URL
        let m2 = finalUrl.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
        m2 = finalUrl.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/);
        if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
        m2 = finalUrl.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
        if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };

    } catch(e) { console.error("Maps resolve error:", e); }
    return null;
}

// ─── BIB SCAN SETTING ────────────────────────────────────────────────────────
async function getBibScanEnabled() {
    const rows = await dbGet('shop_settings', 'id=eq.bib_scan');
    return rows && rows.length > 0 ? rows[0].is_open : false;
}
async function setBibScanEnabled(val) {
    const rows = await dbGet('shop_settings', 'id=eq.bib_scan');
    if (rows && rows.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/shop_settings?id=eq.bib_scan`, { method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ is_open: val }) });
    } else {
        await dbInsert('shop_settings', { id: 'bib_scan', is_open: val });
    }
}

// ─── GALLERY ─────────────────────────────────────────────────────────────────
async function handleGalleryStart(chatId) {
    try {
        const [runsRaw, bibEnabled] = await Promise.all([dbGet('stride_runs'), getBibScanEnabled()]);
        const runs = runsRaw;

        // SAFE-GATE: If the database returns an error object instead of an array, handle it gracefully
        if (!Array.isArray(runs)) {
            console.error("Supabase Error:", runs);
            throw new Error(runs?.message || "Database returned non-array result");
        }

        // Limit to last 15 runs to prevent Telegram keyboard size errors
        const recentRuns = runs.slice(-15);

        const buttons = recentRuns.map(r => {
            const label = formatRunLabelShort(r);
            // Use ID to avoid Telegram API 64-byte limit for callback_data
            return [{ text: `🏃 ${label}`, callback_data: `gal_r_${r.id}` }];
        });
        buttons.unshift([{ text: "📸 General / No specific run", callback_data: "gal_r_general" }]);
        buttons.push([{ text: bibEnabled ? "🔵 Bib Scanner: ON  (tap to disable)" : "⚫ Bib Scanner: OFF (tap to enable)", callback_data: "gal_toggle_bib" }]);
        buttons.push([{ text: "🏷️ Smart Tag Existing", callback_data: "gal_smart_tag" }]);
        buttons.push([{ text: "🗑️ Delete a Photo", callback_data: "cmd_gallery_delete" }]);
        buttons.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
        await sendMessage(chatId, `📸 <b>Gallery</b>\n\nAdd photos — pick which run they're from:\n\n${bibEnabled ? '🔵 AI Bib Scanner is <b>ON</b>' : '⚫ AI Bib Scanner is <b>OFF</b>'}`, { inline_keyboard: buttons });
    } catch (e) {
        console.error("Gallery Fail:", e);
        await sendMessage(chatId, "❌ <b>Gallery Error:</b> Failed to load runs. Check your database connection.");
    }
}

async function handleGalleryRunPicked(chatId, runId) {
    let label = '';
    if (runId !== 'general') {
        const runs = await dbGet('stride_runs', `id=eq.${runId}`);
        if (runs && runs.length > 0) {
            label = runs[0].date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0].date_label;
        } else {
            await sendMessage(chatId, "❌ Run not found.");
            return;
        }
    }
    await setSession('waiting_gallery_photo', { runLabel: label });
    const msg = label
        ? `✅ Run: *${label}*\n\n📸 Now *send the photo*! You can add a caption too.\n\nSend one photo at a time.`
        : `📸 *Send the photo now!* You can add a caption too.\n\nSend one photo at a time.`;
    await sendMessage(chatId, msg);
}

async function detectBibsInImage(imgBuffer) {
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: "INSTRUCTIONS: You are a professional race timer for a running club called Stride Rite. Look EXTREMELY closely at this photo. Find EVERY runner bib number visible (numbers pinned to their shirts).\n\nIMPORTANT RULES:\n1. Only return numbers between 100 and 500. These are our valid bib ranges.\n2. Ignore any other numbers (year labels, distances, banner text, crowd signs).\n3. Return ONLY the valid bib numbers separated by commas (Example: 100, 201, 350).\n4. If no valid bibs are found, return 'none'.\n5. Do NOT include any sentences or explanations." },
                        { inline_data: { mime_type: "image/jpeg", data: Buffer.from(imgBuffer).toString('base64') } }
                    ]
                }]
            })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'none';
        if (text.trim().toLowerCase() === 'none') return [];
        
        const matches = text.match(/\d+/g);
        return matches ? [...new Set(matches.map(s => s.trim()))] : [];
    } catch (e) { 
        console.error("Bib detect error:", e); 
        throw e; // Throw so we can report errors to the admin
    }
}

async function handleGalleryPhoto(chatId, message, session) {
    const photos = message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const initialCaption = message.caption || '';
    const runLabel = session.data.runLabel || '';
    
    // Check if bib scanner is enabled
    const bibEnabled = await getBibScanEnabled();
    
    await sendMessage(chatId, bibEnabled ? "⏳ Uploading photo & scanning for bib numbers..." : "⏳ Uploading photo...");
    
    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) { await sendMessage(chatId, "❌ Couldn't get the file from Telegram."); return; }
    
    const imgRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    if (!imgRes.ok) { await sendMessage(chatId, "❌ Failed to download photo."); return; }
    const imgBuffer = await imgRes.arrayBuffer();
    
    // AI Detect Bibs ONLY if enabled
    let bibs = [];
    if (bibEnabled) {
        try { bibs = await detectBibsInImage(imgBuffer); } catch(e) { console.error("Bib detect fail:", e.message); }
    }
    const bibTags = bibs.length > 0 ? ` [BIBS:${bibs.join(',')}]` : '';
    const caption = initialCaption + bibTags;

    const fileName = `${Date.now()}.jpg`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${fileName}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg' },
        body: imgBuffer
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        await sendMessage(chatId, `❌ Storage upload failed: ${errText}`);
        return;
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/gallery/${fileName}`;
    await dbInsert('gallery_photos', { run_label: runLabel || null, photo_url: publicUrl, caption });
    
    const allPhotosRes = await dbGet('gallery_photos', 'order=uploaded_at.asc&select=id,photo_url');
    const allPhotos = Array.isArray(allPhotosRes) ? allPhotosRes : [];
    
    if (allPhotos.length > 150) {
        const toDelete = allPhotos.slice(0, allPhotos.length - 150);
        for (const old of toDelete) {
            const oldFileName = old.photo_url.split('/public/gallery/')[1];
            if (oldFileName) {
                await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${oldFileName}`, { method: 'DELETE', headers: dbHeaders });
            }
            await fetch(`${SUPABASE_URL}/rest/v1/gallery_photos?id=eq.${old.id}`, { method: 'DELETE', headers: dbHeaders });
        }
    }
    
    const totalNow = Math.min(allPhotos.length + 1, 150);
    const bibMsg = bibs.length > 0 ? `\n🏷️ *AI identified bibs:* ${bibs.join(', ')}` : '\n🔍 _No bib numbers detected._';
    const autoDeletedMsg = allPhotos.length > 150 ? `\n♻️ _Oldest photo auto-removed to stay within 150 limit_` : '';
    
    await sendMessage(chatId,
        `✅ *Photo added to gallery!*${bibMsg}\n\n🎨 Caption: ${initialCaption || '_none_'}\n📸 Gallery: ${totalNow}/150 photos${autoDeletedMsg}`,
        { inline_keyboard: [[{ text: "📸 Add Another", callback_data: `gal_r_${session.data.runId || 'general'}` }], [{ text: "↩️ Menu", callback_data: "cmd_menu" }]] }
    );
}

async function handleGallerySmartTagAll(chatId) {
    const statusMsg = await sendMessage(chatId, "⏳ <b>Starting Smart Tagging...</b>\nEstablishing AI connection...");
    const statusId = statusMsg.message_id;

    const photos = await dbGet('gallery_photos');
    if (!photos || photos.length === 0) { 
        await editMessage(chatId, statusId, "❌ No photos in gallery to tag."); 
        return; 
    }
    
    // Filter out already tagged photos first
    const untagged = photos.filter(p => !p.caption || !p.caption.includes('[BIBS:'));
    const alreadyTagged = photos.length - untagged.length;

    if (untagged.length === 0) {
        await editMessage(chatId, statusId, `✅ <b>All photos already tagged!</b>\n\n🏷️ ${alreadyTagged} photos indexed.\n\nRefresh your gallery and search any bib number!`);
        return;
    }

    await editMessage(chatId, statusId, `⏳ <b>Smart Tagging ${untagged.length} photos...</b>\n\n⏱️ Free tier: ~1 photo every 3 seconds.\nEstimated time: ~${Math.ceil(untagged.length * 3.5 / 60)} min\n\n<i>Please wait...</i>`);

    let taggedCount = 0;
    let errorCount = 0;
    let current = 0;

    for (const p of untagged) {
        current++;

        // Update progress every 5 photos
        if (current % 5 === 0 || current === untagged.length) {
            await editMessage(chatId, statusId, `⏳ <b>Smart Tagging in progress...</b>\n\n🖼️ Photo ${current}/${untagged.length}\n✅ Bibs found: ${taggedCount}\n⚠️ Errors: ${errorCount}`).catch(() => {});
        }
        
        try {
            const imgRes = await fetch(p.photo_url);
            if (!imgRes.ok) throw new Error("Image download failed");
            const imgBuffer = await imgRes.arrayBuffer();
            const bibs = await detectBibsInImage(imgBuffer);
            
            if (bibs.length > 0) {
                const newCaption = (p.caption || '') + ` [BIBS:${bibs.join(',')}]`;
                await dbPatch('gallery_photos', 'id', p.id, { caption: newCaption });
                taggedCount++;
            }
        } catch (e) { 
            console.error("Retro scan fail:", e.message);
            errorCount++;
        }

        // ⏱️ Rate limit protection: 3.5s delay = max ~17 requests/min (safe under 20 limit)
        if (current < untagged.length) {
            await new Promise(resolve => setTimeout(resolve, 3500));
        }
    }
    
    await editMessage(chatId, statusId, `✅ <b>Smart Tagging Complete!</b>\n\n📊 Total photos: ${photos.length}\n🏷️ Newly tagged: ${taggedCount}\n✅ Already indexed: ${alreadyTagged}\n⚠️ Errors: ${errorCount}\n\n<b>Refresh your gallery page and search any bib number!</b>`);
}


async function handleGalleryDeleteList(chatId, messageId = null) {
    const session = await getSession();
    let selected = [];
    if (session.state === 'gallery_multi_del') {
        selected = session.data.selected || [];
    } else {
        await setSession('gallery_multi_del', { selected: [] });
    }

    const photos = await dbGet('gallery_photos', 'order=uploaded_at.desc&limit=15');
    if (!photos || photos.length === 0) {
        if (messageId) await sendMessage(chatId, "❌ No photos in the gallery yet.");
        else await sendMessage(chatId, "❌ No photos in the gallery yet.");
        return;
    }

    const buttons = photos.map((p, i) => {
        const isSelected = selected.includes(p.id);
        const icon = isSelected ? '✅' : '⬜️';
        const label = p.caption || (p.run_label ? `🏃 ${p.run_label}` : `Photo ${i + 1}`);
        return [{ text: `${icon} ${i + 1}. ${label.slice(0, 35)}`, callback_data: `gal_tgl_del_${p.id}` }];
    });

    if (selected.length > 0) {
        buttons.push([{ text: `🗑️ Delete Selected (${selected.length})`, callback_data: `gal_del_bulk_conf` }]);
    }

    buttons.push([{ text: "↩️ Back Menu", callback_data: "cmd_gallery_start" }]);

    const text = `🗑️ *Bulk Delete Photos*\n\nTap to select the photos you want to permanently delete:`;

    if (messageId) {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } })
        });
    } else {
        await sendMessage(chatId, text, { inline_keyboard: buttons });
    }
}

async function handleGalleryBulkConfirm(chatId) {
    const session = await getSession();
    const sel = session.data.selected || [];
    if (sel.length === 0) return;
    await sendMessage(chatId, `⚠️ *Delete ${sel.length} photos?*\nThis cannot be undone.`, {
        inline_keyboard: [
            [{ text: `✅ Yes, Delete ${sel.length} Photos`, callback_data: `gal_del_bulk_yes` }],
            [{ text: "❌ Cancel", callback_data: "cmd_gallery_delete" }]
        ]
    });
}

async function handleGalleryBulkExecute(chatId) {
    const session = await getSession();
    const sel = session.data.selected || [];
    if (sel.length === 0) { await sendMessage(chatId, "❌ Nothing selected."); return; }

    await sendMessage(chatId, `⏳ Deleting ${sel.length} photos...`);

    for (const photoId of sel) {
        const photos = await dbGet('gallery_photos', `id=eq.${photoId}`);
        if (photos && photos.length > 0) {
            const photoUrl = photos[0].photo_url;
            const fileName = photoUrl.split('/public/gallery/')[1];
            if (fileName) {
                await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${fileName}`, { method: 'DELETE', headers: dbHeaders });
            }
            await fetch(`${SUPABASE_URL}/rest/v1/gallery_photos?id=eq.${photoId}`, { method: 'DELETE', headers: dbHeaders });
        }
    }
    await clearSession();
    await sendMessage(chatId, `✅ *Successfully deleted ${sel.length} photos!*`);
    await sendMenu(chatId, "What else?");
}

// ─── SHOP ADMIN ──────────────────────────────────────────────────────────────
async function handleShopMenu(chatId) {
    const settings = await dbGet('shop_settings');
    const isShopOpen = (settings && settings.length > 0) ? settings[0].is_open : false;
    const statusText = isShopOpen ? "🟢 *OPEN* (Visible to everyone)" : "🔴 *CLOSED* (Hidden)";
    const toggleText = isShopOpen ? "🔴 Hide Shop / Turn Off" : "🟢 Open Shop / Turn On";
    await sendMessage(chatId, `🛍️ *Shop Admin*\n\nCurrent Status: ${statusText}`, {
        inline_keyboard: [
            [{ text: toggleText, callback_data: `shop_toggle_${!isShopOpen}` }],
            [{ text: "📦 Export All Orders (Excel)", callback_data: "cmd_shop_export" }],
            [{ text: "👕 Manage Products", callback_data: "cmd_shop_prd_menu" }],
            [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]
        ]
    });
}

async function handleShopToggle(chatId, newStateStr) {
    const newState = newStateStr === "true";
    const settings = await dbGet('shop_settings');
    if (settings && settings.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/shop_settings?id=eq.${settings[0].id}`, {
            method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ is_open: newState })
        });
    } else {
        await dbInsert('shop_settings', { id: crypto.randomUUID(), is_open: newState });
    }
    await sendMessage(chatId, newState ? "✅ Shop is now *LIVE* to the community!" : "🚫 Shop is now *HIDDEN*.");
    await handleShopMenu(chatId);
}

async function handleShopOrderApprove(chatId, orderId, messageId, isPhoto) {
    await updateOrderStatusAndEmail(chatId, orderId, 'approved', 'template_qgow76l', messageId, isPhoto);
}
async function handleShopOrderReject(chatId, orderId, messageId, isPhoto) {
    await updateOrderStatusAndEmail(chatId, orderId, 'rejected', 'template_59dgsfw', messageId, isPhoto);
}

function formatWhatsAppPhone(phone) {
    if (!phone) return '';
    let p = phone.replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '20' + p.substring(1);
    return p;
}

async function updateOrderStatusAndEmail(chatId, orderId, newStatus, templateId, messageId, isPhoto) {
    const orders = await dbGet('shop_orders', `id=eq.${orderId}`);
    if (!orders || orders.length === 0) return;
    const order = orders[0];
    const items = await dbGet('shop_items', `id=eq.${order.item_id}`);
    const item = items[0] || { name: 'Item', price: '0' };
    const users = await dbGet('stride_users', `id=eq.${order.user_id}`);
    const user = users[0] || { name: 'Runner', email: '' };

    await dbPatch('shop_orders', 'id', orderId, { status: newStatus });

    // Send Email notification
    try {
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: 'service_d2aff6e',
                template_id: templateId,
                user_id: 'GBTxpiwg_SF7bN2tH',
                accessToken: '9yAc3NjCBB5wATwThsv6U',
                template_params: { to_name: user.name, to_email: user.email, price: item.price, item_name: item.name, item_size: order.size }
            })
        });
    } catch (e) { console.error("Email fail", e); }

    const statusEmoji = newStatus === 'approved' ? '✅' : '❌';
    const waPhone = formatWhatsAppPhone(order.phone_number);
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hey ${user.name}! Your order for ${item.name} has been ${newStatus} ${statusEmoji}`)}`;

    const text = `${statusEmoji} *ORDER ${newStatus.toUpperCase()}*\n\n👤 *Customer:* ${user.name}\n📧 *Email:* ${user.email}\n📞 *Phone:* ${order.phone_number}\n\n🛍️ *Item:* ${item.name}\n📏 *Size:* ${order.size}\n💰 *Price:* ${item.price} EGP\n\n💳 *Payment Prop:* ${order.payment_method || 'N/A'}\n🔢 *Ref:* \`${order.payment_detail || order.receipt_ref || order.reference || 'N/A'}\`\n\n📅 *Order Date:* ${new Date(order.created_at).toLocaleString()}`;

    // Detect if we need to edit a CAPTION (photo message) or TEXT (normal message)
    const method = isPhoto ? 'editMessageCaption' : 'editMessageText';
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "📲 WhatsApp Customer", url: waUrl }], [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]] }
    };
    if (isPhoto) payload.caption = text;
    else payload.text = text;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

async function handleShopExportOrders(chatId) {
    await sendMessage(chatId, "⏳ Compiling orders...");
    const orders = await dbGet('shop_orders');
    const items = await dbGet('shop_items');
    const users = await dbGet('stride_users');
    let csv = "Date,Customer Name,Phone,Email,Item,Size,Price,Status,Reference Number\n";
    for (const o of (orders || [])) {
        const item = (items || []).find(i => i.id === o.item_id) || {};
        const user = (users || []).find(u => u.id === o.user_id) || {};
        csv += `"${new Date(o.created_at).toLocaleDateString()}","${user.name || 'Unknown'}","${o.phone_number || ''}","${user.email || ''}","${item.name || 'Unknown'}","${o.size}","${item.price || ''}","${o.status}","${o.receipt_ref || o.reference || ''}","${o.payment_method || 'InstaPay/Telda'}"\n`;
    }
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', new Blob([csv], { type: 'text/csv' }), `StrideRite_Shop_Orders.csv`);
    formData.append('caption', `📦 Here is the full list of Shop Orders (${(orders || []).length} total).`);
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: formData });
}

async function handleShopProductMenu(chatId) {
    const items = await dbGet('shop_items');
    const buttons = [];
    (items || []).forEach(item => {
        const icon = item.is_active ? '🟢' : '🔴';
        buttons.push([{ text: `${icon} ${item.name} (${item.price} EGP)`, callback_data: `shop_prd_edit_mn_${item.id}` }]);
    });
    buttons.push([{ text: "➕ Add New Product", callback_data: "cmd_shop_prd_add" }]);
    buttons.push([{ text: "↩️ Back to Shop Admin", callback_data: "cmd_shop_menu" }]);
    await sendMessage(chatId, "👕 *Manage Products*\n\nHere are the items currently in your store:", { inline_keyboard: buttons });
}

async function uploadShopPhoto(chatId, message) {
    const photos = message.photo;
    const fileId = photos[photos.length - 1].file_id;
    await sendMessage(chatId, "⏳ Uploading photo to Shop cloud...");
    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return null;
    const imgRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    if (!imgRes.ok) return null;
    const imgBuffer = await imgRes.arrayBuffer();
    const fileName = `shop_${Date.now()}.jpg`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${fileName}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg' },
        body: imgBuffer
    });
    if (!uploadRes.ok) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/gallery/${fileName}`;
}

async function uploadRouteDocument(chatId, document) {
    const fileId = document.file_id;
    await sendMessage(chatId, "⏳ Uploading GPX route file to Cloud...");
    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return null;
    const docRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    if (!docRes.ok) return null;
    const docBuffer = await docRes.arrayBuffer();
    const fileName = `route_${Date.now()}.gpx`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${fileName}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/gpx+xml' },
        body: docBuffer
    });
    if (!uploadRes.ok) {
        console.error("Storage upload failed", await uploadRes.text());
        return null;
    }
    return `${SUPABASE_URL}/storage/v1/object/public/gallery/${fileName}`;
}

async function handleShopProductAdd(chatId) {
    await setSession('shop_add_item', { step: 'name' });
    await sendMessage(chatId, "🛍️ *Add New Product (Step 1/4)*\n\nWhat is the name of this product?");
}

async function handleShopProductEditMenu(chatId, productId) {
    const items = await dbGet('shop_items', `id=eq.${productId}`);
    if (!items || items.length === 0) return;
    const item = items[0];
    const statusObj = item.is_active ? { icon: '🔴', text: 'Hide Product', val: false } : { icon: '🟢', text: 'Show Product', val: true };
    const buttons = [
        [{ text: "✏️ Edit Name", callback_data: `shop_prd_upd_name_${item.id}` }],
        [{ text: "✏️ Edit Price", callback_data: `shop_prd_upd_price_${item.id}` }],
        [{ text: "✏️ Edit Sizes", callback_data: `shop_prd_upd_sizes_${item.id}` }],
        [{ text: "📸 Edit Photo", callback_data: `shop_prd_upd_photo_${item.id}` }],
        [{ text: `${statusObj.icon} ${statusObj.text}`, callback_data: `shop_prd_tgl_${item.id}_${statusObj.val}` }],
        [{ text: "🗑️ Delete Product", callback_data: `shop_prd_del_${item.id}` }],
        [{ text: "↩️ Back to Products", callback_data: "cmd_shop_prd_menu" }]
    ];
    await sendMessage(chatId, `🛠️ *Edit Product: ${item.name}*\n\nPrice: ${item.price} EGP\nSizes: ${item.sizes}\nStatus: ${item.is_active ? 'Live 🟢' : 'Hidden 🔴'}\n\nWhat would you like to change?`, { inline_keyboard: buttons });
}

async function handleShopProductUpdateField(chatId, productId, fieldStr) {
    await setSession('shop_edit_item', { productId, field: fieldStr });
    let msg = "";
    if (fieldStr === 'name') msg = "✏️ Send the new *Name*:";
    if (fieldStr === 'price') msg = "✏️ Send the new *Price* (e.g. 300):";
    if (fieldStr === 'sizes') msg = "✏️ Send the new *Sizes* (e.g. S, M, L, XL):";
    if (fieldStr === 'photo') msg = "📸 Send the *new photo* directly in this chat:";
    await sendMessage(chatId, msg);
}

async function handleShopProductToggle(chatId, dataStr) {
    const parts = dataStr.split('_');
    const newState = parts.pop() === "true";
    const productId = parts.join('_');
    await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${productId}`, {
        method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ is_active: newState })
    });
    await sendMessage(chatId, `✅ Product visibility updated!`);
    await handleShopProductEditMenu(chatId, productId);
}

async function handleShopProductDelete(chatId, productId) {
    await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${productId}`, { method: 'DELETE', headers: dbHeaders });
    await sendMessage(chatId, `🗑️ ✅ Product permanently deleted.`);
    await handleShopProductMenu(chatId);
}

// ─── EDIT RUN ──────────────────────────────────────────────────────────────
async function handleEditList(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs to edit."); return; }
    const buttons = runs.map((r, i) => {
        const dt = formatRunLabelShort(r);
        return [{ text: `✏️ ${i + 1}. ${dt}`, callback_data: `edit_pick_${r.id}` }];
    });
    buttons.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "✏️ *Which run do you want to edit?*", { inline_keyboard: buttons });
}

async function handleEditPickField(chatId, runId) {
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ Run not found."); return; }
    const r = runs[0];
    const dt = formatRunLabelShort(r);
    await setSession('edit_choosing_field', { runId, runLabel: dt });
    await sendMessage(chatId, `✏️ *Editing:* ${dt}\n\nWhat do you want to change?`, {
        inline_keyboard: [
            [{ text: "⏰ Date & Time", callback_data: "edit_field_datetime" }],
            [{ text: "📍 Location OR Tour Stop Name", callback_data: "edit_field_location" }],
            [{ text: "🗺️ Maps Link", callback_data: "edit_field_maps" }],
            [{ text: "📍 Tour Stop #", callback_data: "edit_field_tour" }],
            [{ text: "🤝 Partner Info", callback_data: "edit_field_partner" }],
            [{ text: "🗺️ Upload GPX Map", callback_data: "edit_field_gpx" }],
            [{ text: "↩️ Back", callback_data: "cmd_edit_list" }]
        ]
    });
}

async function handleEditDateTime(chatId) {
    const session = await getSession();
    const amHours = [4, 5, 6, 7, 8, 9, 10, 11].map(h => ({ text: `${h} AM`, callback_data: `edit_hour_${String(h).padStart(2, '0')}` }));
    const pmHours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => ({ text: `${h} PM`, callback_data: `edit_hour_${String(h + 12).padStart(2, '0')}` }));
    const special = [{ text: "12 PM", callback_data: "edit_hour_12" }, { text: "12 AM", callback_data: "edit_hour_00" }];
    const rows = [];
    for (let i = 0; i < amHours.length; i += 4) rows.push(amHours.slice(i, i + 4));
    rows.push(special);
    for (let i = 0; i < pmHours.length; i += 4) rows.push(pmHours.slice(i, i + 4));
    rows.push([{ text: "↩️ Back", callback_data: `edit_pick_${session.data.runId}` }]);
    await setSession('edit_picking_hour', session.data);
    await sendMessage(chatId, "⏰ *New time — pick the hour:*", { inline_keyboard: rows });
}

async function handleEditHour(chatId, hour) {
    const session = await getSession();
    await setSession('edit_picking_minutes', { ...session.data, hour });
    const h = parseInt(hour);
    const label = h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
    await sendMessage(chatId, `✅ Hour: *${label}*\n\n⏱️ *Minutes?*`, {
        inline_keyboard: [
            [{ text: ":00 (Sharp)", callback_data: "edit_min_00" }, { text: ":30", callback_data: "edit_min_30" }],
            [{ text: "↩️ Back", callback_data: "edit_field_datetime" }]
        ]
    });
}

async function handleEditMinutes(chatId, min) {
    const session = await getSession();
    await setSession('edit_picking_date', { ...session.data, min });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = [];
    for (let i = 1; i <= 21; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        days.push({ text: `${dayNames[d.getDay()]} ${monthNames[d.getMonth()]} ${d.getDate()}`, callback_data: `edit_date_${d.toISOString().split('T')[0]}` });
    }
    const rows = [];
    for (let i = 0; i < days.length; i += 2) rows.push(days.slice(i, i + 2));
    rows.push([{ text: "↩️ Back", callback_data: "edit_field_datetime" }]);
    await sendMessage(chatId, `✅ Time: *${formatTime(`${session.data.hour}:${min}`)}*\n\n📅 *New date?*`, { inline_keyboard: rows });
}

async function handleEditTour(chatId) {
    const session = await getSession();
    const rows = [];
    for (let i = 1; i <= 8; i += 4) {
        rows.push([
            { text: `Stop ${i}`, callback_data: `edit_stop_save_${i}` },
            { text: `Stop ${i + 1}`, callback_data: `edit_stop_save_${i + 1}` },
            { text: `Stop ${i + 2}`, callback_data: `edit_stop_save_${i + 2}` },
            { text: `Stop ${i + 3}`, callback_data: `edit_stop_save_${i + 3}` }
        ]);
    }
    rows.push([{ text: "👟 No Stop (Normal Run)", callback_data: `edit_stop_save_0` }]);
    rows.push([{ text: "↩️ Back", callback_data: `edit_pick_${session.data.runId}` }]);
    await sendMessage(chatId, "📍 *Edit Tour Stop #*\n\nWhich stop number should this be?", { inline_keyboard: rows });
}

async function handleEditTourSave(chatId, stopNum) {
    const session = await getSession();
    const { runId } = session.data;
    const val = parseInt(stopNum) || null;
    await dbPatch('stride_runs', 'id', runId, { tour_stop_id: val === 0 ? null : val });
    await sendMessage(chatId, `✅ *Run updated!* Tour Stop set to: ${val === 0 ? 'None' : val}`);
    await clearSession();
    await handleEditPickField(chatId, runId);
}

async function handleEditDate(chatId, date) {
    const session = await getSession();
    const time = `${session.data.hour}:${session.data.min}`;
    const dateObj = new Date(`${date}T${time}`);
    const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const ft = formatTime(time);
    const newLabel = `${fd} - ${ft}||${dateObj.toISOString()}`;
    await dbPatch('stride_runs', 'id', session.data.runId, { date_label: newLabel });
    await clearSession();
    await sendMessage(chatId, `✅ *Run Updated!*\n\n📅 New date: *${fd}*\n⏰ New time: *${ft}*`);
    await sendMenu(chatId, "What else?");
}

async function handleEditLocation(chatId) {
    const session = await getSession();
    await setSession('edit_waiting_location', session.data);
    await sendMessage(chatId, `📍 *New Location / Tour Stop Name for:*\n${session.data.runLabel}\n\nType the new location name (this updates both Location and Tour Stop Name):`);
}

async function handleEditMaps(chatId) {
    const session = await getSession();
    await setSession('edit_waiting_maps', session.data);
    await sendMessage(chatId, `🗺️ *New Maps link for:*\n${session.data.runLabel}\n\nPaste the new Google Maps link:`);
}

async function handleEditSaveLocation(chatId, text) {
    const session = await getSession();
    await dbPatch('stride_runs', 'id', session.data.runId, { location: text, tour_stop_name: text });
    await clearSession();
    await sendMessage(chatId, `✅ *Location / Tour Stop Name updated to:*\n📍 ${text}`);
    await sendMenu(chatId, "What else?");
}

async function handleEditPartner(chatId) {
    const session = await getSession();
    await setSession('edit_waiting_partner_name', session.data);
    await sendMessage(chatId, `🤝 *Edit Partner Info for:*\n${session.data.runLabel}\n\nType the Partner Club Name (or 'None' to clear):`);
}

async function handleEditPartnerIgSetup(chatId, text) {
    const session = await getSession();
    if (text.toLowerCase() === 'none') {
        await dbPatch('stride_runs', 'id', session.data.runId, { partner_name: null, partner_ig: null, partner_logo: null });
        await clearSession();
        await sendMessage(chatId, `✅ *Partner info cleared.*`);
        await sendMenu(chatId, "What else?");
        return;
    }
    await setSession('edit_waiting_partner_ig', { ...session.data, partnerName: text });
    await sendMessage(chatId, `✅ Name: ${text}\n\nType their Instagram Link (or @handle):`);
}

async function handleEditPartnerLogoSetup(chatId, text) {
    const session = await getSession();
    await setSession('edit_waiting_partner_logo', { ...session.data, partnerIg: text });
    await sendMessage(chatId, `✅ IG: ${text}\n\n📸 Send their Logo image directly in this chat, or type 'Skip':`);
}

async function handleEditGpx(chatId) {
    const session = await getSession();
    await setSession('edit_waiting_gpx', session.data);
    await sendMessage(chatId, `🗺️ *Edit GPX Map for:*\n${session.data.runLabel}\n\nUpload the .gpx file, or type 'None' to remove existing map.`);
}

async function handleEditSaveMaps(chatId, text) {
    const session = await getSession();
    await dbPatch('stride_runs', 'id', session.data.runId, { location_link: text });
    await clearSession();
    await sendMessage(chatId, `✅ *Maps link updated!*\n🗺️ ${text}`);
    await sendMenu(chatId, "What else?");
}

// ─── GROWTH GRAPH ─────────────────────────────────────────────────────────────
async function handleGrowthGraph(chatId) {
    await sendMessage(chatId, "📈 Generating growth graph...");
    const users = await dbGet('stride_users');
    if (!users || users.length === 0) { await sendMessage(chatId, "❌ No members yet."); return; }
    const monthCounts = {};
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    users.forEach(u => {
        const date = u.created_at || u.registered_at;
        if (!date) return;
        const d = new Date(date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthCounts[key] = (monthCounts[key] || 0) + 1;
    });
    const keys = Object.keys(monthCounts).sort();
    if (keys.length === 0) { await sendMessage(chatId, "❌ No registration dates found."); return; }
    const labels = keys.map(k => {
        const [y, m] = k.split('-');
        return `${monthNames[parseInt(m) - 1]} '${y.slice(2)}`;
    });
    let cumulative = 0;
    const data = keys.map(k => { cumulative += monthCounts[k]; return cumulative; });
    const newThisMonth = monthCounts[keys[keys.length - 1]] || 0;
    const totalMembers = data[data.length - 1];
    const chartConfig = {
        type: 'line',
        data: {
            labels,
            datasets: [{ label: 'Total Members', data, borderColor: '#7c6ffa', backgroundColor: 'rgba(88,74,220,0.15)', fill: true, tension: 0.4, pointBackgroundColor: '#ff9e6d', pointRadius: 6, borderWidth: 3 }]
        },
        options: {
            plugins: { legend: { display: false }, title: { display: true, text: '🏃 Stride Rite — Community Growth', color: '#ffffff', font: { size: 16, weight: 'bold' } } },
            scales: { y: { beginAtZero: true, ticks: { color: '#a1a1aa', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.08)' } }, x: { ticks: { color: '#a1a1aa' }, grid: { display: false } } }
        }
    };
    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&backgroundColor=%23141419&width=700&height=380`;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: chatId,
            photo: chartUrl,
            caption: `📈 *Community Growth Chart*\n\n👥 *Total Members:* ${totalMembers}\n🆕 *New This Month:* ${newThisMonth}\n📅 *Tracking since:* ${labels[0]}`,
            parse_mode: 'Markdown'
        })
    });
}

// ─── STATS ────────────────────────────────────────────────────────────────────
async function handleStats(chatId) {
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs scheduled."); return; }
    const nextRun = runs[0]; // Chronologically closest upcoming run
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');
    let males = 0, females = 0, totalAge = 0;
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) { u.gender === 'Male' ? males++ : females++; totalAge += calculateAge(u.birthdate || '') || (parseInt(u.age) || 0); }
    });
    const avgAge = regs.length > 0 ? Math.round(totalAge / regs.length) : 0;
    const dt = formatRunLabelMultiline(nextRun);
    await sendMessage(chatId, `📊 *Next Run Stats*\n${dt}\n\n👥 *Total RSVPs:* ${regs.length}\n🤸 *Gender:* ${males}M / ${females}F\n⏰ *Avg Age:* ${avgAge} years`);
}

// ─── LIST RUNS ────────────────────────────────────────────────────────────────
async function handleListRuns(chatId) {
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs scheduled."); return; }
    let msg = `📋 *Upcoming Scheduled Runs (${runs.length}):*\n\n`;
    runs.forEach((r, i) => {
        const dt = formatRunLabelShort(r);
        const cancelled = r.is_cancelled ? ' 🚫 CANCELLED' : '';
        msg += `*${i + 1}.* ${dt}${cancelled}\n`;
    });
    await sendMessage(chatId, msg);
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
async function handleExport(chatId) {
    await sendMessage(chatId, "⏳ Generating export for the next upcoming run...");
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs found."); return; }
    const nextRun = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');
    let csv = "Name,Email,Age,Birthdate,Gender,Distance,Level,Registration Timestamp\n";
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) {
            const age = u.birthdate ? calculateAge(u.birthdate) : (u.age || '');
            csv += `"${u.name}","${u.email}","${age}","${u.birthdate || ''}","${u.gender}","${r.distance}","${r.level || u.level}","${r.registered_at}"\n`;
        }
    });
    const dt = nextRun.date_label.split('||')[0];
    let hypeFilename = `Stride_Rite_Manifest_${dt.replace(/[^a-zA-Z0-9]/g, '_')}.csv`;
    if (nextRun.tour_stop_id) {
        const stopName = (nextRun.tour_stop_name || nextRun.location).toUpperCase().replace(/\s+/g, '_');
        hypeFilename = `MISSION_ROSTER_STAGE_${nextRun.tour_stop_id}_${stopName}_RESTRICTED.csv`;
    }
    
    await sendDocument(chatId, csv, hypeFilename);
}

// ─── WHATSAPP BLAST ───────────────────────────────────────────────────────────
async function handleBlast(chatId) {
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs scheduled."); return; }
    const r = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${r.id}`);
    const dtStr = formatRunLabelMultiline(r);
    const registered = regs.length > 0 ? `✅ *${regs.length} runner${regs.length > 1 ? 's' : ''} already registered!*` : '';
    await sendMessage(chatId, `📲 *Copy & paste into WhatsApp for the upcoming run:*\n\n🏃‍♂️ Stride Rite Community Run 🏃‍♀️\n\n${dtStr}\n📍 ${r.location}\n🗺️ ${r.location_link}\n\n${registered}\n\nDon't miss it! Register 👇\n${SITE_URL}\n\n_Every pace is welcome. See you there!_ 💪`);
}

// ─── SURVEY & FEEDBACK ────────────────────────────────────────────────────────
async function handleSurveyMenu(chatId) {
    await sendMessage(chatId, "📝 *Feedback Management*\n\nWhat would you like to do?", {
        inline_keyboard: [
            [{ text: "🔗 Share Survey Link", callback_data: "cmd_survey_link" }],
            [{ text: "📊 View Feedback Hub", callback_data: "cmd_survey_hub" }],
            [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]
        ]
    });
}

async function handleSurveyHub(chatId) {
    await sendMessage(chatId, `📊 *Feedback Hub*\n\nView community ratings and feedback here:\n${SITE_URL}/admin-feedback.html`);
}

async function handleSurvey(chatId) {
    const runs = await dbGet('stride_runs');
    if (!Array.isArray(runs) || runs.length === 0) {
        await sendMessage(chatId, "❌ No runs found or database error.");
        return;
    }
    // Safely get the last inserted run
    const lastRun = runs[runs.length - 1];
    const dt = formatRunLabelShort(lastRun);
    const url = `${SITE_URL}/survey.html?run=${encodeURIComponent(dt)}`;
    await sendMessage(chatId, `📝 *Post-Run Survey:*\n\n🏃 Hey Striders!\n\nHow did today's run feel? Tell us in 30 seconds 👇\n\n${url}\n\nThank you! See you next time 🙌`);
}

// ─── RUNNER LOOKUP ────────────────────────────────────────────────────────────
async function handleLookupStart(chatId) {
    await setSession('waiting_lookup_name');
    await sendMessage(chatId, "🔍 <b>Runner Lookup</b>\n\nType the runner's <b>Name</b> or <b>Bib Number</b>:");
}

async function handleLookup(chatId, query) {
    await clearSession();
    const users = await dbGet('stride_users');
    const q = query.toLowerCase();
    const matches = (users || []).filter(u => 
        u.name.toLowerCase().includes(q) || 
        (u.bib_number && u.bib_number.toString() === query)
    );
    if (matches.length === 0) { await sendMessage(chatId, `❌ No runner found matching "<b>${esc(query)}</b>"`); return; }

    for (const u of matches.slice(0, 3)) {
        const allRegs = await dbGet('stride_registrations', `user_id=eq.${u.id}`);
        const allRuns = await dbGet('stride_runs');
        const age = u.birthdate ? calculateAge(u.birthdate) : (u.age || '?');
        const birthStr = u.birthdate ? new Date(u.birthdate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not provided';
        const bib = u.bib_number ? `🔢 <b>BIB: ${u.bib_number}</b>` : '🔢 <i>No Bib assigned</i>';
        
        let history = '';
        if (allRegs && allRegs.length > 0) {
            history = allRegs.map(r => {
                const run = (allRuns || []).find(rr => rr.id === r.run_id);
                const label = run ? formatRunLabelShort(run) : 'Past run';
                return `  • ${label} — ${r.distance}`;
            }).join('\n');
        }
        
        await sendMessage(chatId,
            `👤 <b>${esc(u.name)}</b>
${bib}
📧 ${esc(u.email)}
🎂 ${esc(birthStr)} (Age ${age})
⚧️ ${esc(u.gender)}
🏃 <b>Level:</b> ${esc(u.level)}

📋 <b>Run History (${allRegs ? allRegs.length : 0} runs):</b>
${esc(history) || '  No runs yet'}`);
    }
}

// ─── BROADCAST ────────────────────────────────────────────────────────────────
async function handleBroadcastStart(chatId) {
    await setSession('waiting_broadcast_msg');
    await sendMessage(chatId, "📣 *Broadcast to All Runners*\n\nType the message you want to send to everyone.\nI'll give you all their emails ready to copy into Gmail.");
}

async function handleBroadcast(chatId, message) {
    await clearSession();
    const users = await dbGet('stride_users');
    const emails = (users || []).filter(u => !u.is_admin).map(u => u.email);
    const bccList = emails.join(',');
    const subject = encodeURIComponent('Message from Stride Rite 🏃');
    const body = encodeURIComponent(message);
    const mailtoLink = `https://mail.google.com/mail/?view=cm&bcc=${encodeURIComponent(bccList)}&su=${subject}&body=${body}`;
    await sendMessage(chatId,
        `📣 *Broadcast Ready!*

📧 *${emails.length} runners* will receive this message.

*Your message:*
"${message}"

*All emails (copy these as BCC):*
\`${bccList}\`

👆 Copy emails above and paste into BCC in Gmail:
${mailtoLink}`);
}

// ─── CANCEL RUN ───────────────────────────────────────────────────────────────
async function handleCancelList(chatId) {
    const runs = await dbGet('stride_runs');
    const active = (runs || []).filter(r => !r.is_cancelled);
    if (active.length === 0) { await sendMessage(chatId, "❌ No active runs to cancel."); return; }
    const buttons = active.map((r, i) => {
        const dt = formatRunLabelShort(r);
        return [{ text: `🚫 ${i + 1}. ${dt}`, callback_data: `cancel_pick_${r.id}` }];
    });
    buttons.push([{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🚫 *Which run do you want to cancel?*", { inline_keyboard: buttons });
}

async function handleCancelPick(chatId, runId) {
    await setSession('waiting_cancel_reason', { runId });
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    const dt = runs[0] ? formatRunLabelShort(runs[0]) : 'Unknown Run';
    await sendMessage(chatId, `🚫 *Cancel: ${dt}*\n\nPlease type the reason for cancellation:`);
}

async function handleCancelExecute(chatId, runId, reason) {
    await clearSession();
    await dbPatch('stride_runs', 'id', runId, { is_cancelled: true, cancel_reason: reason });
    const regs = await dbGet('stride_registrations', `run_id=eq.${runId}`);
    const users = await dbGet('stride_users');
    const registeredEmails = (regs || []).map(r => {
        const u = (users || []).find(uu => uu.id === r.user_id);
        return u ? u.email : null;
    }).filter(Boolean);
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    const dt = runs[0]?.date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0]?.date_label;
    await sendMessage(chatId,
        `✅ *Run Cancelled!*

📅 ${dt}
📝 *Reason:* ${reason}
👥 *${registeredEmails.length} runners were registered*

📣 *Notify them — copy into Gmail BCC:*
\`${registeredEmails.join(',')}\`

Suggested message:
<i>Hey Striders! Unfortunately the ${esc(dt)} run has been cancelled due to ${esc(reason)}. We apologize and look forward to seeing you at the next run! 💪</i>`);
}

// ─── DELETE LIST ──────────────────────────────────────────────────────────────
async function handleDeleteList(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs to delete."); return; }
    const buttons = runs.map((r, i) => {
        const dt = formatRunLabelShort(r);
        return [{ text: `${i + 1}. ${dt}`, callback_data: `cmd_delete_confirm_${r.id}` }];
    });
    buttons.push([{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🗑️ <b>Which run do you want to delete?</b>", { inline_keyboard: buttons });
}

async function handleDeleteConfirmOne(chatId, runId) {
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ Run not found."); return; }
    const dt = runs[0] ? formatRunLabelShort(runs[0]) : 'Unknown Run';
    await sendMessage(chatId, `🗑️ *Delete "${dt}"?*\n\nThis removes all registrations too!`, {
        inline_keyboard: [
            [{ text: "✅ Yes, Delete", callback_data: `cmd_delete_execute_${runId}` }],
            [{ text: "❌ Cancel", callback_data: "cmd_delete_list" }]
        ]
    });
}

// ─── CREATE FLOW ──────────────────────────────────────────────────────────────
async function createSetup(chatId) {
    await setSession('setup_type', { step: 1 });
    await sendMessage(chatId, "🆕 <b>Create New Run</b>\n\nIs this a Tour de Cairo run (Stops 1-8)?", {
        inline_keyboard: [
            [{ text: "Yes, Tour de Cairo Stop", callback_data: "create_tour_yes" }],
            [{ text: "No, Normal Run", callback_data: "create_tour_no" }],
            [{ text: "↩️ Back", callback_data: "cmd_menu" }]
        ]
    });
}

async function createTourStopSetup(chatId) {
    await setSession('setup_stop', { step: 1, isTour: true });
    const rows = [];
    for (let i = 1; i <= 8; i += 4) {
        rows.push([
            { text: `Stop ${i}`, callback_data: `create_stop_v2_${i}` },
            { text: `Stop ${i + 1}`, callback_data: `create_stop_v2_${i + 1}` },
            { text: `Stop ${i + 2}`, callback_data: `create_stop_v2_${i + 2}` },
            { text: `Stop ${i + 3}`, callback_data: `create_stop_v2_${i + 3}` }
        ]);
    }
    rows.push([{ text: "↩️ Back", callback_data: "create_setup_start" }]);
    await sendMessage(chatId, "<b>Step 1</b>: Which Tour Stop number is this?", { inline_keyboard: rows });
}

async function handleAskStopName(chatId, stopNum) {
    await setSession('setup_stop_name', { stopNum, isTour: true });
    await sendMessage(chatId, `📍 <b>Stop ${stopNum} Selected</b>\n\nWhat is the <b>Name</b> of this stop?\n(e.g. <i>Heliopolis Hills</i> or <i>The Sphinx Sprint</i>)`);
}

async function createPartnerSetup(chatId, initData) {
    await setSession('setup_partner', initData);
    await sendMessage(chatId, `✅ Stop ${esc(initData.stopNum)}: <b>${esc(initData.stopName)}</b>\n\n<b>Step 2</b>: Who is hosting this run?`, {
        inline_keyboard: [
            [{ text: "🤝 Stride Rite x Partner", callback_data: "create_partner_yes" }],
            [{ text: "👟 Stride Rite Only", callback_data: "create_partner_no" }],
            [{ text: "↩️ Back", callback_data: "create_tour_yes" }]
        ]
    });
}

async function createPartnerName(chatId, isPartner, initData) {
    if (!isPartner) {
        await setSession('picking_time', { ...initData, isPartner: false, isTour: true });
        await createStep1(chatId);
    } else {
        await setSession('partner_name', { ...initData, isPartner: true, isTour: true });
        await sendMessage(chatId, "🤝 <b>Partner Details</b>\n\nPlease type the Partner Club Name:");
    }
}

async function createPartnerIg(chatId, partnerName, sessionData) {
    await setSession('partner_ig', { ...sessionData, partnerName });
    await sendMessage(chatId, `✅ Name: ${partnerName}\n\nPlease type their Instagram Link (or @handle):`);
}

async function createPartnerLogo(chatId, partnerIg, sessionData) {
    await setSession('partner_logo', { ...sessionData, partnerIg });
    await sendMessage(chatId, `✅ IG: ${partnerIg}\n\n📸 Send their Logo image directly in this chat:`);
}

async function createStep1(chatId) {
    const existing = await getSession();
    const baseData = (existing.state.startsWith('partner_') || existing.state.startsWith('picking_') || existing.state.startsWith('setup_')) ? existing.data : {};
    await setSession('picking_time', baseData);
    const amHours = [4, 5, 6, 7, 8, 9, 10, 11].map(h => ({ text: `${h} AM`, callback_data: `create_hour_${String(h).padStart(2, '0')}` }));
    const pmHours = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(h => ({ text: `${h} PM`, callback_data: `create_hour_${String(h + 12).padStart(2, '0')}` }));
    const special = [{ text: "12 PM", callback_data: "create_hour_12" }, { text: "12 AM", callback_data: "create_hour_00" }];
    const rows = [];
    for (let i = 0; i < amHours.length; i += 4) rows.push(amHours.slice(i, i + 4));
    rows.push(special);
    for (let i = 0; i < pmHours.length; i += 4) rows.push(pmHours.slice(i, i + 4));
    rows.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🆕 <b>Create New Run — Step 1/5</b>\n\n⏰ What <b>hour</b> will the run start?", { inline_keyboard: rows });
}

async function createStep1b(chatId, hour) {
    const session = await getSession();
    await setSession('picking_minutes', { ...session.data, hour });
    const h = parseInt(hour);
    const label = h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
    await sendMessage(chatId, `✅ Hour: *${label}*\n\n⏱️ *Minutes?*`, {
        inline_keyboard: [
            [{ text: ":00 (Sharp)", callback_data: "create_min_00" }, { text: ":30", callback_data: "create_min_30" }],
            [{ text: "↩️ Back", callback_data: "create_step1" }]
        ]
    });
}

async function createStep2(chatId, hour, min) {
    const session = await getSession();
    await setSession('picking_date', { ...session.data, time: `${hour}:${min}` });
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = [];
    for (let i = 1; i <= 21; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        days.push({ text: `${dayNames[d.getDay()]} ${monthNames[d.getMonth()]} ${d.getDate()}`, callback_data: `create_date_${d.toISOString().split('T')[0]}` });
    }
    const rows = [];
    for (let i = 0; i < days.length; i += 2) rows.push(days.slice(i, i + 2));
    rows.push([{ text: "↩️ Back", callback_data: "create_step1" }]);
    await sendMessage(chatId, `✅ Time: <b>${esc(formatTime(`${hour}:${min}`))}</b>\n\n<b>Step 2/5</b> — 📅 Pick the run date:`, { inline_keyboard: rows });
}

async function createStep3(chatId, date, sessionData) {
    await setSession('waiting_maps_link', { ...sessionData, date });
    const d = new Date(date);
    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    await sendMessage(chatId, `✅ <b>${esc(label)}</b> at <b>${esc(formatTime(sessionData.time))}</b>\n\n<b>Step 3/5</b> — 📍 Send the <b>Google Maps link</b> for the location:`);
}

async function createStep4(chatId, mapsLink, sessionData) {
    await setSession('waiting_location_name', { ...sessionData, mapsLink });
    await sendMessage(chatId, `✅ Maps link saved!\n\n<b>Step 4/6</b> — 🏷️ What's the <b>location name?</b>\nExample: <i>Gateway Mall, Al Rehab City</i>`);
}

async function createStep5(chatId, locationName, sessionData) {
    await setSession('waiting_route_map', { ...sessionData, locationName });
    await sendMessage(chatId, `✅ Location Name saved!\n\n*Step 5/6* — 🗺️ Upload the *GPX route file* for this run.\n\n(Simply attach the .gpx file, or type "Skip" if you don't have it right now)`);
}

async function createConfirm(chatId, locationName, routeMap, routeType, sessionData) {
    // routeMap comes from text or photo upload. routeType is 'link' or 'image'
    const fullData = { ...sessionData, locationName, routeMap, routeType };
    await setSession('confirming', fullData);
    const dateObj = new Date(`${fullData.date}T${fullData.time}`);
    const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    await sendMessage(chatId,
        `📋 <b>Step 6/6 — Confirm New Run</b>\n\n📅 <b>${esc(fd)}</b>\n⏰ <b>${esc(formatTime(fullData.time))}</b>\n📍 <b>${esc(fullData.locationName)}</b>\n🗺️ ${esc(fullData.mapsLink)}\n\n<b>Route Preview attached!</b> Looks good?`,
        { inline_keyboard: [[{ text: "✅ Create Run!", callback_data: "create_confirm_yes" }], [{ text: "❌ Cancel", callback_data: "cmd_menu" }]] }
    );
}

async function createExecute(chatId) {
    const session = await getSession();
    const d = session.data;
    try {
        const dateObj = new Date(`${d.date}T${d.time}`);
        const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const ft = formatTime(d.time);

        let previewVal = d.routeMap;
        if (previewVal && previewVal.toLowerCase() === 'skip') previewVal = null;

        await dbInsert('stride_runs', {
            id: crypto.randomUUID(), date_label: `${fd} - ${ft}||${dateObj.toISOString()}`,
            location: d.locationName, location_link: d.mapsLink,
            description: 'Every pace is welcome!', created_by: 'admin-1',
            route_preview_url: previewVal,
            route_type: previewVal ? d.routeType : 'image',
            tour_stop_id: d.isTour ? (parseInt(d.stopNum) || null) : null,
            tour_stop_name: d.isTour ? (d.stopName || null) : null,
            partner_name: d.partnerName || null,
            partner_ig: d.partnerIg || null,
            partner_logo: d.partnerLogo || null
        });

        // Sync Tour Stop Coords if tour
        if (d.isTour && d.lat && d.lng && d.stopNum) {
            await dbPatch('stride_tour_stops', 'id', d.stopNum, { lat: d.lat, lng: d.lng });
            // Also update name if provided
            if (d.stopName) {
                await dbPatch('stride_tour_stops', 'id', d.stopNum, { name: d.stopName });
            }
        }

        await clearSession();
        await sendMessage(chatId, `🎉 <b>Run Created!</b>\n\n📅 ${fd}\n⏰ ${ft}\n📍 ${d.locationName}\n\nLive on the site now! 🚀`);
        await sendMenu(chatId, "What else do you want to do?");
    } catch (e) {
        console.error(e);
        await sendMessage(chatId, "❌ Something went wrong while saving the run. Try again from the menu.");
    }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
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
            else if (data === 'cmd_survey_menu') await handleSurveyMenu(chatId);
            else if (data === 'cmd_survey_link') await handleSurvey(chatId);
            else if (data === 'cmd_survey_hub') await handleSurveyHub(chatId);
            else if (data === 'cmd_survey') await handleSurvey(chatId); // legacy
            else if (data === 'cmd_birthdays') await checkBirthdays(chatId);
            else if (data === 'cmd_growth') await handleGrowthGraph(chatId);
            else if (data === 'cmd_lookup_start') await handleLookupStart(chatId);
            else if (data === 'cmd_broadcast_start') await handleBroadcastStart(chatId);
            else if (data === 'cmd_cancel_list') await handleCancelList(chatId);
            else if (data === 'cmd_delete_list') await handleDeleteList(chatId);
            else if (data.startsWith('cancel_pick_')) await handleCancelPick(chatId, data.replace('cancel_pick_', ''));
            else if (data.startsWith('cmd_delete_confirm_')) await handleDeleteConfirmOne(chatId, data.replace('cmd_delete_confirm_', ''));
            else if (data.startsWith('cmd_delete_execute_')) {
                const runId = data.replace('cmd_delete_execute_', '');
                await dbDelete('stride_registrations', 'run_id', runId);
                await dbDelete('stride_runs', 'id', runId);
                await sendMessage(chatId, "✅ *Run deleted!*");
                await sendMenu(chatId, "What else?");
            }
            else if (data === 'cmd_gallery_start') await handleGalleryStart(chatId);
            else if (data.startsWith('gal_r_')) await handleGalleryRunPicked(chatId, data.replace('gal_r_', ''));
            else if (data === 'gal_smart_tag') await handleGallerySmartTagAll(chatId);
            else if (data === 'gal_toggle_bib' || data === 'gal_toggle_bib_menu') {
                const current = await getBibScanEnabled();
                await setBibScanEnabled(!current);
                if (data === 'gal_toggle_bib_menu') await sendMenu(chatId);
                else await handleGalleryStart(chatId);
            }
            else if (data === 'cmd_gallery_delete') await handleGalleryDeleteList(chatId);
            else if (data.startsWith('gal_tgl_del_')) {
                const photoId = data.replace('gal_tgl_del_', '');
                const session = await getSession();
                let selected = session.data.selected || [];
                if (selected.includes(photoId)) selected = selected.filter(id => id !== photoId);
                else selected.push(photoId);
                await setSession('gallery_multi_del', { selected });
                await handleGalleryDeleteList(chatId, cq.message.message_id);
            }
            else if (data === 'gal_del_bulk_conf') await handleGalleryBulkConfirm(chatId);
            else if (data === 'gal_del_bulk_yes') await handleGalleryBulkExecute(chatId);
            else if (data === 'cmd_shop_menu') await handleShopMenu(chatId);
            else if (data.startsWith('shop_toggle_')) await handleShopToggle(chatId, data.replace('shop_toggle_', ''));
            else if (data.startsWith('shop_appr_')) await handleShopOrderApprove(chatId, data.replace('shop_appr_', ''), cq.message.message_id, !!cq.message.photo);
            else if (data.startsWith('shop_rej_')) await handleShopOrderReject(chatId, data.replace('shop_rej_', ''), cq.message.message_id, !!cq.message.photo);
            else if (data === 'cmd_shop_export') await handleShopExportOrders(chatId);
            else if (data === 'cmd_shop_prd_menu') await handleShopProductMenu(chatId);
            else if (data === 'cmd_shop_prd_add') await handleShopProductAdd(chatId);
            else if (data.startsWith('shop_prd_edit_mn_')) await handleShopProductEditMenu(chatId, data.replace('shop_prd_edit_mn_', ''));
            else if (data.startsWith('shop_prd_upd_name_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_name_', ''), 'name');
            else if (data.startsWith('shop_prd_upd_price_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_price_', ''), 'price');
            else if (data.startsWith('shop_prd_upd_sizes_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_sizes_', ''), 'sizes');
            else if (data.startsWith('shop_prd_upd_photo_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_photo_', ''), 'photo');
            else if (data.startsWith('shop_prd_tgl_')) await handleShopProductToggle(chatId, data.replace('shop_prd_tgl_', ''));
            else if (data.startsWith('shop_prd_del_')) await handleShopProductDelete(chatId, data.replace('shop_prd_del_', ''));
            else if (data === 'cmd_edit_list') await handleEditList(chatId);
            else if (data === 'cmd_ai_strat') await handleAIStart(chatId);
            else if (data === 'cmd_tour_editor') await handleTourEditorStart(chatId);
            else if (data.startsWith('tour_edit_pick_')) await handleTourEditorPick(chatId, data.replace('tour_edit_pick_', ''));
            else if (data.startsWith('tour_edit_name_')) await handleTourEditorWaitName(chatId, data.replace('tour_edit_name_', ''));
            else if (data.startsWith('tour_edit_loc_')) await handleTourEditorWaitLoc(chatId, data.replace('tour_edit_loc_', ''));
            // Tour Admin
            else if (data === 'cmd_tour_admin') await handleTourAdmin(chatId);
            else if (data === 'tour_new_season') await handleTourNewSeasonStart(chatId);
            else if (data === 'tour_delete_all_confirm') await handleTourDeleteAllConfirm(chatId);
            else if (data === 'tour_delete_all_yes') await handleTourDeleteAllExecute(chatId);
            else if (data === 'tour_season_confirm_yes') await handleTourSeasonExecute(chatId);
            // Test Center
            else if (data === 'cmd_test_center') await handleTestCenter(chatId);
            else if (data === 'test_add') await handleTestAdd(chatId);
            else if (data.startsWith('test_del_')) await handleTestDelete(chatId, data.replace('test_del_', ''));
            else if (data.startsWith('edit_pick_')) await handleEditPickField(chatId, data.replace('edit_pick_', ''));
            else if (data === 'edit_field_datetime') await handleEditDateTime(chatId);
            else if (data === 'edit_field_location') await handleEditLocation(chatId);
            else if (data === 'edit_field_maps') await handleEditMaps(chatId);
            else if (data === 'edit_field_tour') await handleEditTour(chatId);
            else if (data === 'edit_field_partner') await handleEditPartner(chatId);
            else if (data === 'edit_field_gpx') await handleEditGpx(chatId);
            else if (data.startsWith('edit_stop_save_')) await handleEditTourSave(chatId, data.replace('edit_stop_save_', ''));
            else if (data.startsWith('edit_hour_')) await handleEditHour(chatId, data.replace('edit_hour_', ''));
            else if (data.startsWith('edit_min_')) await handleEditMinutes(chatId, data.replace('edit_min_', ''));
            else if (data.startsWith('edit_date_')) await handleEditDate(chatId, data.replace('edit_date_', ''));

            // New Setup Overrides
            else if (data === 'create_step1' || data === 'create_setup_start') await createSetup(chatId);
            else if (data === 'create_tour_yes') await createTourStopSetup(chatId);
            else if (data === 'create_tour_no') { await setSession('picking_time', { isTour: false }); await createStep1(chatId); }
            else if (data.startsWith('create_stop_v2_')) await handleAskStopName(chatId, data.replace('create_stop_v2_', ''));
            else if (data === 'create_partner_yes') { const s = await getSession(); await createPartnerName(chatId, true, { ...s.data, isTour: true }); }
            else if (data === 'create_partner_no') { const s = await getSession(); await createPartnerName(chatId, false, { ...s.data, isTour: true }); }

            else if (data.startsWith('create_hour_')) await createStep1b(chatId, data.replace('create_hour_', ''));
            else if (data.startsWith('create_min_')) {
                const session = await getSession();
                await createStep2(chatId, session.data.hour, data.replace('create_min_', ''));
            }
            else if (data.startsWith('create_date_')) {
                const session = await getSession();
                await createStep3(chatId, data.replace('create_date_', ''), session.data);
            }
            else if (data === 'create_confirm_yes') await createExecute(chatId);

            res.status(200).send('ok'); return;
        }

        // Handle photo messages
        if (body.message && body.message.photo) {
            const chatId = body.message.chat.id.toString();
            if (chatId === ADMIN_CHAT_ID) {
                const session = await getSession();
                if (session.state === 'waiting_gallery_photo') {
                    await handleGalleryPhoto(chatId, body.message, session);
                } else if (session.state === 'partner_logo') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message);
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload photo."); res.status(200).send('ok'); return; }
                    await setSession('picking_time', { ...session.data, partnerLogo: imgUrl });
                    await createStep1(chatId);
                } else if (session.state === 'edit_waiting_partner_logo') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message);
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload logo."); res.status(200).send('ok'); return; }
                    await dbPatch('stride_runs', 'id', session.data.runId, { partner_name: session.data.partnerName, partner_ig: session.data.partnerIg, partner_logo: imgUrl });
                    await clearSession();
                    await sendMessage(chatId, `✅ *Partner info updated (with Logo)!*`);
                    await sendMenu(chatId, "What else?");
                } else if (session.state === 'waiting_route_map') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message);
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload map photo. Type 'Skip' or try again."); res.status(200).send('ok'); return; }
                    await createConfirm(chatId, session.data.locationName, imgUrl, 'image', session.data);
                } else if (session.state === 'shop_add_item' && session.data.step === 'photo') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message);
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload photo."); res.status(200).send('ok'); return; }
                    await dbInsert('shop_items', {
                        id: crypto.randomUUID(),
                        name: session.data.name,
                        price: parseInt(session.data.price),
                        sizes: session.data.sizes,
                        image_url: imgUrl,
                        is_active: true
                    });
                    await sendMessage(chatId, "✅ <b>Product successfully added to the VIP Shop!</b>");
                    await clearSession();
                    await handleShopProductMenu(chatId);
                } else if (session.state === 'shop_edit_item' && session.data.field === 'photo') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message);
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload photo."); res.status(200).send('ok'); return; }
                    await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${session.data.productId}`, {
                        method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ image_url: imgUrl })
                    });
                    await sendMessage(chatId, "✅ <b>Photo successfully updated!</b>");
                    await clearSession();
                    await handleShopProductEditMenu(chatId, session.data.productId);
                } else if (session.state === 'partner_logo') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message); // reuse upload helper
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload logo."); res.status(200).send('ok'); return; }
                    await setSession('waiting_maps_link', { ...session.data, partnerLogo: imgUrl });
                    await sendMessage(chatId, "✅ <b>Logo successfully saved!</b>\n\n<b>Step 3/6</b> — 📍 Send me the <b>Google Maps location link</b> for the start point:");
                } else {
                    await sendMessage(chatId, "📸 Got a photo! Choose an option from the menus to attach it somewhere.");
                }
            }
            res.status(200).send('ok'); return;
        }

        // Handle Document Uploads (e.g. GPX files)
        if (body.message && body.message.document) {
            const chatId = body.message.chat.id.toString();
            if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
            const session = await getSession();

            if (session.state === 'edit_waiting_gpx') {
                const doc = body.message.document;
                if (!doc.file_name || !doc.file_name.toLowerCase().endsWith('.gpx')) {
                    await sendMessage(chatId, "❌ Please send a valid `.gpx` file, or type 'None'.");
                    res.status(200).send('ok'); return;
                }
                const fileUrl = await uploadRouteDocument(chatId, doc);
                if (!fileUrl) {
                    await sendMessage(chatId, "❌ Failed to upload GPX file. Try again or type 'None'.");
                    res.status(200).send('ok'); return;
                }
                await dbPatch('stride_runs', 'id', session.data.runId, { route_preview_url: fileUrl, route_type: 'gpx' });
                await clearSession();
                await sendMessage(chatId, `✅ *GPX Map uploaded and saved!*`);
                await sendMenu(chatId, "What else?");
            } else if (session.state === 'waiting_route_map') {
                const doc = body.message.document;
                if (!doc.file_name || !doc.file_name.toLowerCase().endsWith('.gpx')) {
                    await sendMessage(chatId, "❌ Please send a valid `.gpx` file, or type 'Skip'.");
                    res.status(200).send('ok'); return;
                }
                const fileUrl = await uploadRouteDocument(chatId, doc);
                if (!fileUrl) {
                    await sendMessage(chatId, "❌ Failed to upload GPX file. Try again or type 'Skip'.");
                    res.status(200).send('ok'); return;
                }
                await createConfirm(chatId, session.data.locationName, fileUrl, 'gpx', session.data);
            } else {
                await sendMessage(chatId, "📁 Received a document, but I'm not waiting for one right now.");
            }
            res.status(200).send('ok'); return;
        }

        if (!body.message || !body.message.text) { res.status(200).send('ok'); return; }
        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
        const text = (body.message.text || '').trim();
        const cmd = text.split(' ')[0].toLowerCase();

        // ─── ESCAPE HATCH: /start always resets ───
        if (cmd === '/start' || cmd === '/menu' || cmd === '/help') {
            await clearSession();
            await sendMenu(chatId, `👟 <b>Stride Rite Admin Bot</b>\n\nHey Haleem! Your Chat ID is <code>${chatId}</code>.\nWhat do you want to do?`);
            res.status(200).send('ok'); return;
        }

        const session = await getSession();

        if (session.state === 'chatting_with_ai') {
            const history = session.data.history || [];
            await sendMessage(chatId, "🤔 <b>Thinking...</b>");
            
            try {
                const response = await askGemini(chatId, text, history);
                history.push({ role: 'user', text: text });
                history.push({ role: 'ai', text: response });
                
                const trimmedHistory = history.slice(-6);
                await setSession('chatting_with_ai', { history: trimmedHistory });

                await sendMessage(chatId, response, {
                    inline_keyboard: [[{ text: "↩️ Exit Strategist", callback_data: "cmd_menu" }]]
                });
            } catch (aiErr) {
                console.error("AI Error:", aiErr);
                await sendMessage(chatId, "⚠️ <b>AI Error:</b> My strategic circuits hit a snag. Resetting to menu...");
                await clearSession();
                await sendMenu(chatId);
            }
            res.status(200).send('ok'); return;
        }

        // Product addition flow
        if (session.state === 'shop_add_item') {
            const step = session.data.step;
            if (step === 'name') {
                await setSession('shop_add_item', { ...session.data, step: 'price', name: text });
                await sendMessage(chatId, "🛍️ <b>Add New Product (Step 2/4)</b>\n\nWhat is the price in EGP? (e.g., 300)");
                res.status(200).send('ok'); return;
            }
            if (step === 'price') {
                await setSession('shop_add_item', { ...session.data, step: 'sizes', price: text });
                await sendMessage(chatId, "🛍️ <b>Add New Product (Step 3/4)</b>\n\nWhat sizes are available? (e.g., 'S, M, L, XL, XXL')");
                res.status(200).send('ok'); return;
            }
            if (step === 'sizes') {
                await setSession('shop_add_item', { ...session.data, step: 'photo', sizes: text });
                await sendMessage(chatId, "🛍️ <b>Add New Product (Step 4/4)</b>\n\n📸 Now send the <b>product photo</b> from your gallery:");
                res.status(200).send('ok'); return;
            }
            if (step === 'photo') {
                await sendMessage(chatId, "📸 Please send an *IMAGE* from your phone's gallery, not text.");
                res.status(200).send('ok'); return;
            }
        }

        // Product edit flow
        if (session.state === 'shop_edit_item') {
            const { productId, field } = session.data;
            if (field === 'photo') {
                await sendMessage(chatId, "📸 Please send an *IMAGE* from your phone's gallery, not text.");
                res.status(200).send('ok'); return;
            }
            const updateData = {};
            if (field === 'price') updateData[field] = parseInt(text);
            else updateData[field] = text;
            await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${productId}`, {
                method: 'PATCH', headers: dbHeaders, body: JSON.stringify(updateData)
            });
            await sendMessage(chatId, `✅ <b>Product ${esc(field)} successfully updated!</b>`);

            await clearSession();
            await handleShopProductEditMenu(chatId, productId);
            res.status(200).send('ok'); return;
        }

        if (session.state === 'setup_stop_name') {
            await createPartnerSetup(chatId, { ...session.data, stopName: text });
            res.status(200).send('ok'); return;
        }

        if (session.state === 'partner_name') {
            await createPartnerIg(chatId, text, session.data);
            res.status(200).send('ok'); return;
        } else if (session.state === 'partner_ig') {
            await createPartnerLogo(chatId, text, session.data);
            res.status(200).send('ok'); return;
        } else if (session.state === 'partner_logo') {
            // Text handler for logo (only if they typed "Skip")
            if (text.toLowerCase() === 'skip') {
                await setSession('waiting_maps_link', { ...session.data, partnerLogo: null });
                await sendMessage(chatId, "✅ Logo skipped.\n\n<b>Step 3/6</b> — 📍 Send me the <b>Google Maps location link</b> for the start point:");
            } else {
                await sendMessage(chatId, "📸 Please send a <b>photo</b> for the logo, or type 'Skip'.");
            }
            res.status(200).send('ok'); return;
        } else if (session.state === 'waiting_maps_link') {
            const coords = await resolveCoordinates(text);
            if (coords) {
                await setSession('waiting_location_name', { ...session.data, mapsLink: text, lat: coords.lat, lng: coords.lng });
                await sendMessage(chatId, `✅ <b>Coordinates Resolved: (${coords.lat}, ${coords.lng})</b>\n\n<b>Step 4/6</b> — 🏷️ What's the <b>location name?</b>\nExample: <i>Gateway Mall, Al Rehab City</i>`);
            } else {
                await setSession('waiting_manual_coords', { ...session.data, mapsLink: text });
                await sendMessage(chatId, `📍 <b>Link saved, but I couldn't find GPS coordinates automatically.</b>\n\nPlease send the coordinates in <b>lat, lng</b> format (e.g., <code>30.06, 31.22</code>) or type <b>Skip</b> to use the existing map position:`);
            }
            res.status(200).send('ok'); return;
        } else if (session.state === 'waiting_manual_coords') {
            if (text.toLowerCase() === 'skip') {
                await createStep4(chatId, session.data.mapsLink, session.data);
            } else {
                const coords = await resolveCoordinates(text);
                if (coords) {
                    await setSession('waiting_location_name', { ...session.data, lat: coords.lat, lng: coords.lng });
                    await createStep4(chatId, session.data.mapsLink, { ...session.data, lat: coords.lat, lng: coords.lng });
                } else {
                    await sendMessage(chatId, "❌ Invalid format. Please send coordinates like <code>30.06, 31.22</code> or type <b>Skip</b>.");
                }
            }
            res.status(200).send('ok'); return;
        } else if (session.state === 'waiting_location_name') {
            await createStep5(chatId, text, session.data);
            res.status(200).send('ok'); return;
        } else if (session.state === 'waiting_route_map') {
            await createConfirm(chatId, session.data.locationName, text, 'link', session.data);
            res.status(200).send('ok'); return;
        } else if (session.state === 'waiting_lookup_name') {
            await handleLookup(chatId, text);
        } else if (session.state === 'waiting_broadcast_msg') {
            await handleBroadcast(chatId, text);
        } else if (session.state === 'waiting_cancel_reason') {
            await handleCancelExecute(chatId, session.data.runId, text);
        } else if (session.state === 'edit_waiting_location') {
            await handleEditSaveLocation(chatId, text);
        } else if (session.state === 'edit_waiting_maps') {
            await handleEditSaveMaps(chatId, text);
        } else if (session.state === 'edit_waiting_partner_name') {
            await handleEditPartnerIgSetup(chatId, text);
        } else if (session.state === 'edit_waiting_partner_ig') {
            await handleEditPartnerLogoSetup(chatId, text);
        } else if (session.state === 'edit_waiting_partner_logo' && text.toLowerCase() === 'skip') {
            await dbPatch('stride_runs', 'id', session.data.runId, { partner_name: session.data.partnerName, partner_ig: session.data.partnerIg, partner_logo: null });
            await clearSession();
            await sendMessage(chatId, `✅ *Partner info updated (No logo).*`);
            await sendMenu(chatId, "What else?");
        } else if (session.state === 'edit_waiting_gpx' && text.toLowerCase() === 'none') {
            await dbPatch('stride_runs', 'id', session.data.runId, { route_preview_url: null, route_type: 'image' });
            await clearSession();
            await sendMessage(chatId, `✅ *GPX Map cleared.*`);
            await sendMenu(chatId, "What else?");
        } else if (session.state === 'tour_season_waiting_date') {
            await handleTourSeasonDate(chatId, text);
        } else if (session.state === 'tour_season_waiting_time') {
            await handleTourSeasonTime(chatId, text);
        } else if (session.state === 'test_waiting_name') {
            await setSession('test_waiting_url', { testName: text });
            await sendMessage(chatId, `✅ <b>Name: "${esc(text)}"</b>\n\n<b>Step 2/2 — Test URL</b>\n\nNow send me the full link to the test page.\nExample: <code>https://stride-rite.vercel.app/test-v2.html</code>`);
        } else if (session.state === 'test_waiting_url') {
            const testName = session.data.testName;
            await dbInsert('stride_tests', { id: crypto.randomUUID(), name: testName, url: text.trim(), created_at: new Date().toISOString() });
            await clearSession();
            await sendMessage(chatId, `✅ <b>"${esc(testName)}"</b> has been saved to your Test Center!`);
            await handleTestCenter(chatId);
        } else if (session.state === 'tour_edit_waiting_name') {
            await dbPatch('stride_tour_stops', 'id', session.data.stopId, { name: text });
            await clearSession();
            await sendMessage(chatId, `✅ *Stop ${session.data.stopId} Name updated!*`);
            await handleTourEditorStart(chatId);
        } else if (session.state === 'tour_edit_waiting_loc') {
            await sendMessage(chatId, "⏳ Extracting coordinates from map link...");
            const coords = await resolveGoogleMapsLink(text);
            if (!coords) {
                await sendMessage(chatId, "❌ Failed to extract coordinates. Please send a full Google Maps link (tap Share → Copy Link).\n\nOr type /start to go back to the menu.");
                res.status(200).send('ok'); return;
            }
            await dbPatch('stride_tour_stops', 'id', session.data.stopId, { lat: coords.lat, lng: coords.lng });
            await clearSession();
            await sendMessage(chatId, `✅ *Stop ${session.data.stopId} Location updated!* (${coords.lat}, ${coords.lng})\nRefresh your site map to see it connect.`);
            await handleTourEditorStart(chatId);
        } else {
            if (cmd === '/start' || cmd === '/help' || cmd === '/menu') {
                await sendMenu(chatId, `👟 <b>Stride Rite Admin Bot</b>\n\nHey Haleem! Your Chat ID is <code>${chatId}</code>.\nWhat do you want to do?`);
            }
            else if (cmd === '/stats') await handleStats(chatId);
            else if (cmd === '/runs') await handleListRuns(chatId);
            else if (cmd === '/export') await handleExport(chatId);
            else if (cmd === '/blast') await handleBlast(chatId);
            else if (cmd === '/gallery') await handleGalleryStart(chatId);
            else if (cmd === '/survey') await handleSurvey(chatId);
            else if (cmd === '/birthdays') await checkBirthdays(chatId);
            else if (cmd === '/growth') await handleGrowthGraph(chatId);
            else if (cmd === '/lookup') await handleLookupStart(chatId);
            else if (cmd === '/broadcast') await handleBroadcastStart(chatId);
            else if (cmd === '/cancel') await handleCancelList(chatId);
            else if (cmd === '/delete') await handleDeleteList(chatId);
            else if (cmd === '/create') await createSetup(chatId);
            else await sendMenu(chatId, "❓ Unknown command. Use the buttons below!");
        }

        res.status(200).send('ok');
    } catch (e) {
        console.error("HANDLER ERROR:", e);
        try {
            const errStr = e.message || String(e);
            const safeErr = errStr.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            await sendMessage(ADMIN_CHAT_ID, `🚨 <b>Bot Error Reported:</b>\n\n<code>\n${safeErr}\n</code>\n<i>Check logs for full stack trace.</i>`);
        } catch (inner) { console.error("Double Fail:", inner); }
        res.status(200).send('ok'); // Still send 200 to Telegram so it stops retrying-loop
    }
}
