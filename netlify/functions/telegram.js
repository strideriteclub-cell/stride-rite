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
async function clearSession() {
    await setSession('idle', {});
}

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────
async function sendMessage(chatId, text, replyMarkup = null) {
    const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
    if (replyMarkup) body.reply_markup = replyMarkup;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
}
async function answerCallbackQuery(id, text = null) {
    const body = { callback_query_id: id };
    if (text) body.text = text;
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
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
            [{ text: "📝 Survey Link", callback_data: "cmd_survey" }, { text: "🗑️ Delete Next Run", callback_data: "cmd_delete_confirm" }],
            [{ text: "🆕 Create New Run", callback_data: "create_step1" }]
        ]
    });
}

// ─── CREATE RUN: STEP 1 — TIME PICKER ────────────────────────────────────────
async function createStep1(chatId) {
    await clearSession();
    await sendMessage(chatId, "🆕 *Create New Run — Step 1 of 4*\n\n⏰ What time will the run start?", {
        inline_keyboard: [
            [{ text: "5:30 AM", callback_data: "create_time_05:30" }, { text: "6:00 AM", callback_data: "create_time_06:00" }, { text: "6:30 AM", callback_data: "create_time_06:30" }],
            [{ text: "7:00 AM", callback_data: "create_time_07:00" }, { text: "7:30 AM", callback_data: "create_time_07:30" }, { text: "8:00 AM", callback_data: "create_time_08:00" }],
            [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]
        ]
    });
}

// ─── CREATE RUN: STEP 2 — DATE PICKER ────────────────────────────────────────
async function createStep2(chatId, time) {
    await setSession('picking_date', { time });

    // Generate next 6 Saturdays
    const saturdays = [];
    const now = new Date();
    const d = new Date(now);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
    for (let i = 0; i < 6; i++) {
        const copy = new Date(d);
        copy.setDate(d.getDate() + i * 7);
        saturdays.push(copy);
    }

    const buttons = saturdays.map(s => {
        const label = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const val = s.toISOString().split('T')[0];
        return [{ text: `📅 ${label}`, callback_data: `create_date_${val}` }];
    });
    buttons.push([{ text: "↩️ Back", callback_data: "create_step1" }]);

    await sendMessage(chatId, `✅ Time set: *${time}*\n\n*Step 2 of 4* — 📅 Which Saturday?`, { inline_keyboard: buttons });
}

// ─── CREATE RUN: STEP 3 — ASK FOR MAPS LINK ──────────────────────────────────
async function createStep3(chatId, date, time) {
    await setSession('waiting_maps_link', { date, time });
    await sendMessage(chatId,
        `✅ Date set: *${date}* at *${time}*\n\n*Step 3 of 4* — 📍 Please send me the *Google Maps link* for the run location.\n\nJust paste the link and hit send!`
    );
}

// ─── CREATE RUN: STEP 4 — ASK FOR LOCATION NAME ──────────────────────────────
async function createStep4(chatId, mapsLink, sessionData) {
    await setSession('waiting_location_name', { ...sessionData, mapsLink });
    await sendMessage(chatId,
        `✅ Maps link received!\n\n*Step 4 of 4* — 🏷️ Now type the *location name*\n\nExample: _Gateway Mall, Al Rehab City_`
    );
}

// ─── CREATE RUN: CONFIRMATION ─────────────────────────────────────────────────
async function createConfirm(chatId, locationName, sessionData) {
    const fullData = { ...sessionData, locationName };
    await setSession('confirming', fullData);

    const dateObj = new Date(`${fullData.date}T${fullData.time}`);
    const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const ft = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    await sendMessage(chatId,
        `📋 *Confirm New Run*\n\n📅 *Date:* ${fd}\n⏰ *Time:* ${ft}\n📍 *Location:* ${fullData.locationName}\n🗺️ *Maps:* ${fullData.mapsLink}\n\nLooks good?`,
        {
            inline_keyboard: [
                [{ text: "✅ Create Run!", callback_data: "create_confirm_yes" }],
                [{ text: "❌ Cancel", callback_data: "cmd_menu" }]
            ]
        }
    );
}

// ─── CREATE RUN: FINAL EXECUTION ─────────────────────────────────────────────
async function createExecute(chatId) {
    const session = await getSession();
    const d = session.data;
    try {
        const dateObj = new Date(`${d.date}T${d.time}`);
        const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        const ft = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const fullStr = `${fd} - ${ft}||${dateObj.toISOString()}`;
        await dbInsert('stride_runs', {
            id: crypto.randomUUID(), date_label: fullStr,
            location: d.locationName,
            location_link: d.mapsLink,
            description: 'Gather at 7:00 AM, warmup starts by 7:15 AM! Every pace is welcome.',
            created_by: 'admin-1'
        });
        await clearSession();
        await sendMessage(chatId, `🎉 *Run Created Successfully!*\n\n📅 ${fd}\n⏰ ${ft}\n📍 ${d.locationName}\n\nIt's now live on the website! 🚀`);
    } catch(e) {
        await sendMessage(chatId, "❌ Something went wrong creating the run. Please try again.");
    }
}

// ─── OTHER COMMANDS ───────────────────────────────────────────────────────────
async function handleStats(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs currently scheduled."); return; }
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
    await sendMessage(chatId, `📊 *Next Run Stats:*\n📍 *${dt}*\n\n👥 *Total RSVPs:* ${regs.length}\n🤸 *Gender Split:* ${males}M / ${females}F\n⏰ *Average Age:* ${avgAge} years`);
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
    await sendMessage(chatId, "⏳ Generating Excel file...");
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs to export."); return; }
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
    const nextRun = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const count = regs.length;
    const dt = nextRun.date_label.includes('||') ? nextRun.date_label.split('||')[0] : nextRun.date_label;
    const registered = count > 0 ? `✅ *${count} runner${count > 1 ? 's' : ''} already registered!*` : '';
    await sendMessage(chatId, `📲 *Copy & paste this into WhatsApp:*\n\n🏃‍♂️ Stride Rite Community Run 🏃‍♀️\n\n📅 ${dt}\n📍 ${nextRun.location}\n🗺️ ${nextRun.location_link}\n\n${registered}\n\nDon't miss it! Register now at 👇\n${SITE_URL}\n\n_Every pace is welcome. See you there!_ 💪`);
}

async function handleSurvey(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs found."); return; }
    const dt = runs[0].date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0].date_label;
    const surveyUrl = `${SITE_URL}/survey.html?run=${encodeURIComponent(dt)}`;
    await sendMessage(chatId, `📝 *Post-Run Survey:*\n\n🏃 Hey Striders!\n\nWe hope you crushed today's run 💪\n\nTell us how it went in 30 seconds 👇\n${surveyUrl}\n\nSee you next time! 🙌`);
}

async function handleDeleteConfirm(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs to delete."); return; }
    const dt = runs[0].date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0].date_label;
    await sendMessage(chatId, `⚠️ *Delete this run?*\n\n📅 *${dt}*\n\nAll registrations will be lost!`, {
        inline_keyboard: [
            [{ text: "✅ Yes, Delete It", callback_data: `cmd_delete_${runs[0].id}` }],
            [{ text: "❌ Cancel", callback_data: "cmd_menu" }]
        ]
    });
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    if (req.method !== 'POST') { res.status(200).send('Alive'); return; }
    try {
        const body = req.body;

        // ── BUTTON PRESSES ──
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
            else if (data === 'cmd_delete_confirm') await handleDeleteConfirm(chatId);
            else if (data.startsWith('cmd_delete_')) await (async () => {
                const runId = data.replace('cmd_delete_', '');
                await dbDelete('stride_registrations', 'run_id', runId);
                await dbDelete('stride_runs', 'id', runId);
                await sendMessage(chatId, "✅ *Run deleted!*");
            })();
            // Create flow buttons
            else if (data === 'create_step1') await createStep1(chatId);
            else if (data.startsWith('create_time_')) await createStep2(chatId, data.replace('create_time_', ''));
            else if (data.startsWith('create_date_')) {
                const session = await getSession();
                await createStep3(chatId, data.replace('create_date_', ''), session.data.time || '07:00');
            }
            else if (data === 'create_confirm_yes') await createExecute(chatId);

            res.status(200).send('ok'); return;
        }

        // ── TEXT MESSAGES ──
        if (!body.message || !body.message.text) { res.status(200).send('ok'); return; }
        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
        const text = body.message.text.trim();
        const parts = text.split(' ');
        const cmd = parts[0].toLowerCase();

        // Check session state first (for multi-step flows)
        const session = await getSession();

        if (session.state === 'waiting_maps_link') {
            await createStep4(chatId, text, session.data);
        } else if (session.state === 'waiting_location_name') {
            await createConfirm(chatId, text, session.data);
        } else {
            // Normal commands
            if (cmd === '/start' || cmd === '/help' || cmd === '/menu') await sendMenu(chatId);
            else if (cmd === '/stats') await handleStats(chatId);
            else if (cmd === '/runs') await handleListRuns(chatId);
            else if (cmd === '/export') await handleExport(chatId);
            else if (cmd === '/blast') await handleBlast(chatId);
            else if (cmd === '/survey') await handleSurvey(chatId);
            else if (cmd === '/delete') await handleDeleteConfirm(chatId);
            else if (cmd === '/create') await createStep1(chatId);
            else await sendMenu(chatId, "❓ Unknown command. Use the buttons below!");
        }

        res.status(200).send('ok');
    } catch(e) {
        console.error(e);
        res.status(500).send('Error');
    }
}
