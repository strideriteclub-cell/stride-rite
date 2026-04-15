const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const BOT_TOKEN = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
const ADMIN_CHAT_ID = '1538316434';
const SITE_URL = 'https://stride-rite.vercel.app';

const dbHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

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
async function dbUpsert(table, data) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(data)
    });
}

// ─── SESSION HELPERS ──────────────────────────────────────────────────────────
async function getSession() {
    const rows = await dbGet('bot_sessions', 'id=eq.admin');
    return rows && rows.length > 0 ? rows[0] : { state: 'idle', data: {} };
}
async function setSession(state, data = {}) {
    await dbUpsert('bot_sessions', { id: 'admin', state, data, updated_at: new Date().toISOString() });
}
async function clearSession() { await setSession('idle', {}); }

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────
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
async function sendDocument(chatId, content, filename) {
    const boundary = '----Boundary12345';
    let body = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
    body += `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
        method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body
    });
}

// ─── MAIN MENU ────────────────────────────────────────────────────────────────
async function sendMenu(chatId, msg = "👟 *Stride Rite Admin Bot*\nHey Haleem! What do you want to do?") {
    await clearSession();
    await sendMessage(chatId, msg, {
        inline_keyboard: [
            [{ text: "📊 Run Stats", callback_data: "cmd_stats" }, { text: "📋 List All Runs", callback_data: "cmd_runs" }],
            [{ text: "📥 Export Excel", callback_data: "cmd_export" }, { text: "📲 WhatsApp Blast", callback_data: "cmd_blast" }],
            [{ text: "📝 Survey Link", callback_data: "cmd_survey" }, { text: "🗑️ Delete a Run", callback_data: "cmd_delete_list" }],
            [{ text: "🆕 Create New Run", callback_data: "create_step1" }]
        ]
    });
}

// ─── DELETE: LIST ALL RUNS ────────────────────────────────────────────────────
async function handleDeleteList(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs to delete."); return; }
    const buttons = runs.map((r, i) => {
        const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        return [{ text: `${i + 1}. ${dt}`, callback_data: `cmd_delete_confirm_${r.id}` }];
    });
    buttons.push([{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🗑️ *Which run do you want to delete?*\nTap to select:", { inline_keyboard: buttons });
}

async function handleDeleteConfirmOne(chatId, runId) {
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ Run not found."); return; }
    const dt = runs[0].date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0].date_label;
    await sendMessage(chatId, `⚠️ *Are you sure?*\n\n📅 *${dt}*\n\nAll registrations for this run will be deleted!`, {
        inline_keyboard: [
            [{ text: "✅ Yes, Delete It", callback_data: `cmd_delete_execute_${runId}` }],
            [{ text: "❌ Cancel", callback_data: "cmd_delete_list" }]
        ]
    });
}

async function handleDeleteExecute(chatId, runId) {
    await dbDelete('stride_registrations', 'run_id', runId);
    await dbDelete('stride_runs', 'id', runId);
    await sendMessage(chatId, "✅ *Run deleted successfully!*");
    await sendMenu(chatId, "What else do you want to do?");
}

// ─── CREATE: STEP 1 — PICK HOUR ──────────────────────────────────────────────
async function createStep1(chatId) {
    await clearSession();
    const amHours = [4,5,6,7,8,9,10,11].map(h => ({ text: `${h} AM`, callback_data: `create_hour_${String(h).padStart(2,'0')}` }));
    const pmHours = [1,2,3,4,5,6,7,8,9,10,11].map(h => ({ text: `${h} PM`, callback_data: `create_hour_${String(h+12).padStart(2,'0')}` }));
    const midnight = [{ text: "12 PM", callback_data: "create_hour_12" }, { text: "12 AM (midnight)", callback_data: "create_hour_00" }];

    const rows = [];
    for (let i = 0; i < amHours.length; i += 4) rows.push(amHours.slice(i, i + 4));
    rows.push(midnight);
    for (let i = 0; i < pmHours.length; i += 4) rows.push(pmHours.slice(i, i + 4));
    rows.push([{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]);

    await sendMessage(chatId, "🆕 *Create New Run — Step 1 of 5*\n\n⏰ What *hour* will the run start?", { inline_keyboard: rows });
}

// ─── CREATE: STEP 1b — PICK MINUTES ──────────────────────────────────────────
async function createStep1b(chatId, hour) {
    await setSession('picking_minutes', { hour });
    await sendMessage(chatId, `✅ Hour: *${formatHour(hour)}*\n\n⏱️ *Minutes?*`, {
        inline_keyboard: [
            [{ text: ":00 (Sharp)", callback_data: `create_min_00` }, { text: ":30", callback_data: `create_min_30` }],
            [{ text: "↩️ Back", callback_data: "create_step1" }]
        ]
    });
}

// ─── CREATE: STEP 2 — PICK DATE ──────────────────────────────────────────────
async function createStep2(chatId, hour, min) {
    const time = `${hour}:${min}`;
    await setSession('picking_date', { time });

    // Generate next 21 days
    const days = [];
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    for (let i = 1; i <= 21; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        const label = `${dayNames[d.getDay()]} ${monthNames[d.getMonth()]} ${d.getDate()}`;
        const val = d.toISOString().split('T')[0];
        days.push({ text: label, callback_data: `create_date_${val}` });
    }

    const rows = [];
    for (let i = 0; i < days.length; i += 2) rows.push(days.slice(i, i + 2));
    rows.push([{ text: "↩️ Back", callback_data: "create_step1" }]);

    await sendMessage(chatId, `✅ Time set: *${formatTime(time)}*\n\n*Step 2 of 5* — 📅 Pick the run date:`, { inline_keyboard: rows });
}

// ─── CREATE: STEP 3 — MAPS LINK ──────────────────────────────────────────────
async function createStep3(chatId, date, sessionData) {
    await setSession('waiting_maps_link', { ...sessionData, date });
    const d = new Date(date);
    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    await sendMessage(chatId, `✅ Date: *${label}* at *${formatTime(sessionData.time)}*\n\n*Step 3 of 5* — 📍 Send me the *Google Maps link* for the location.\n\nJust paste the link and send!`);
}

// ─── CREATE: STEP 4 — LOCATION NAME ──────────────────────────────────────────
async function createStep4(chatId, mapsLink, sessionData) {
    await setSession('waiting_location_name', { ...sessionData, mapsLink });
    await sendMessage(chatId, `✅ Maps link saved!\n\n*Step 4 of 5* — 🏷️ What's the *location name?*\n\nExample: _Gateway Mall, Al Rehab City_`);
}

// ─── CREATE: CONFIRMATION ─────────────────────────────────────────────────────
async function createConfirm(chatId, locationName, sessionData) {
    const fullData = { ...sessionData, locationName };
    await setSession('confirming', fullData);
    const dateObj = new Date(`${fullData.date}T${fullData.time}`);
    const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    await sendMessage(chatId,
        `📋 *Step 5 of 5 — Confirm New Run*\n\n📅 *${fd}*\n⏰ *${formatTime(fullData.time)}*\n📍 *${fullData.locationName}*\n🗺️ ${fullData.mapsLink}\n\nLooks good? 👇`,
        { inline_keyboard: [
            [{ text: "✅ Create Run!", callback_data: "create_confirm_yes" }],
            [{ text: "❌ Cancel", callback_data: "cmd_menu" }]
        ]}
    );
}

// ─── CREATE: EXECUTE ──────────────────────────────────────────────────────────
async function createExecute(chatId) {
    const session = await getSession();
    const d = session.data;
    try {
        const dateObj = new Date(`${d.date}T${d.time}`);
        const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const ft = formatTime(d.time);
        const fullStr = `${fd} - ${ft}||${dateObj.toISOString()}`;
        await dbInsert('stride_runs', {
            id: crypto.randomUUID(), date_label: fullStr,
            location: d.locationName, location_link: d.mapsLink,
            description: 'Every pace is welcome!', created_by: 'admin-1'
        });
        await clearSession();
        await sendMessage(chatId, `🎉 *Run Created!*\n\n📅 ${fd}\n⏰ ${ft}\n📍 ${d.locationName}\n\nIt's now live on the site! 🚀`);
        await sendMenu(chatId, "What else do you want to do?");
    } catch(e) {
        await sendMessage(chatId, "❌ Something went wrong. Try again from the menu.");
    }
}

// ─── OTHER COMMANDS ───────────────────────────────────────────────────────────
async function handleStats(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs scheduled."); return; }
    const nextRun = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');
    let males = 0, females = 0, totalAge = 0;
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) { u.gender === 'Male' ? males++ : females++; totalAge += parseInt(u.age) || 0; }
    });
    const avgAge = regs.length > 0 ? Math.round(totalAge / regs.length) : 0;
    const dt = nextRun.date_label.includes('||') ? nextRun.date_label.split('||')[0] : nextRun.date_label;
    await sendMessage(chatId, `📊 *Next Run Stats*\n📍 ${dt}\n\n👥 *Total RSVPs:* ${regs.length}\n🤸 *Gender:* ${males}M / ${females}F\n⏰ *Avg Age:* ${avgAge} years`);
}

async function handleListRuns(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs scheduled."); return; }
    let msg = `📋 *All Scheduled Runs (${runs.length}):*\n\n`;
    runs.forEach((r, i) => {
        const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        msg += `*${i + 1}.* ${dt}\n`;
    });
    await sendMessage(chatId, msg);
}

async function handleExport(chatId) {
    await sendMessage(chatId, "⏳ Generating...");
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs."); return; }
    const nextRun = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');
    let csv = "Name,Email,Age,Gender,Distance,Level,Registration Timestamp\n";
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) csv += `"${u.name}","${u.email}","${u.age}","${u.gender}","${r.distance}","${r.level || u.level}","${r.registered_at}"\n`;
    });
    const dt = nextRun.date_label.includes('||') ? nextRun.date_label.split('||')[0] : nextRun.date_label;
    await sendDocument(chatId, csv, `Stride_Rite_${dt.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
}

async function handleBlast(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs scheduled."); return; }
    const r = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${r.id}`);
    const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
    const registered = regs.length > 0 ? `✅ *${regs.length} runner${regs.length > 1 ? 's' : ''} already registered!*` : '';
    await sendMessage(chatId, `📲 *Copy & paste into WhatsApp:*\n\n🏃‍♂️ Stride Rite Community Run 🏃‍♀️\n\n📅 ${dt}\n📍 ${r.location}\n🗺️ ${r.location_link}\n\n${registered}\n\nDon't miss it! Register 👇\n${SITE_URL}\n\n_Every pace is welcome. See you there!_ 💪`);
}

async function handleSurvey(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs found."); return; }
    const dt = runs[0].date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0].date_label;
    const url = `${SITE_URL}/survey.html?run=${encodeURIComponent(dt)}`;
    await sendMessage(chatId, `📝 *Post-Run Survey:*\n\n🏃 Hey Striders!\n\nHow did today's run feel? Tell us in 30 seconds 👇\n\n${url}\n\nThank you! See you next time 🙌`);
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function formatHour(hour) {
    const h = parseInt(hour);
    if (h === 0) return '12:00 AM';
    if (h === 12) return '12:00 PM';
    return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}
function formatTime(time) {
    const [h, m] = time.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr = h % 12 || 12;
    return `${hr}:${String(m).padStart(2,'0')} ${ampm}`;
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
            else if (data === 'cmd_survey') await handleSurvey(chatId);
            else if (data === 'cmd_delete_list') await handleDeleteList(chatId);
            else if (data.startsWith('cmd_delete_confirm_')) await handleDeleteConfirmOne(chatId, data.replace('cmd_delete_confirm_', ''));
            else if (data.startsWith('cmd_delete_execute_')) await handleDeleteExecute(chatId, data.replace('cmd_delete_execute_', ''));
            // Create flow
            else if (data === 'create_step1') await createStep1(chatId);
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

        if (!body.message || !body.message.text) { res.status(200).send('ok'); return; }
        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
        const text = body.message.text.trim();
        const cmd = text.split(' ')[0].toLowerCase();

        const session = await getSession();

        if (session.state === 'waiting_maps_link') {
            await createStep4(chatId, text, session.data);
        } else if (session.state === 'waiting_location_name') {
            await createConfirm(chatId, text, session.data);
        } else {
            if (cmd === '/start' || cmd === '/help' || cmd === '/menu') await sendMenu(chatId);
            else if (cmd === '/stats') await handleStats(chatId);
            else if (cmd === '/runs') await handleListRuns(chatId);
            else if (cmd === '/export') await handleExport(chatId);
            else if (cmd === '/blast') await handleBlast(chatId);
            else if (cmd === '/survey') await handleSurvey(chatId);
            else if (cmd === '/delete') await handleDeleteList(chatId);
            else if (cmd === '/create') await createStep1(chatId);
            else await sendMenu(chatId, "❓ Unknown command. Use the buttons below!");
        }

        res.status(200).send('ok');
    } catch(e) {
        console.error(e);
        res.status(500).send('Error');
    }
}
