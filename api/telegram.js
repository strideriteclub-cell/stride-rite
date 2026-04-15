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
async function sendMenu(chatId, msg = "👟 *Stride Rite Admin Bot*\nHey Haleem! What do you want to do?") {
    await clearSession();
    await sendMessage(chatId, msg, {
        inline_keyboard: [
            [{ text: "📊 Run Stats", callback_data: "cmd_stats" }, { text: "📋 List All Runs", callback_data: "cmd_runs" }],
            [{ text: "📥 Export Excel", callback_data: "cmd_export" }, { text: "📲 WhatsApp Blast", callback_data: "cmd_blast" }],
            [{ text: "📝 Survey Link", callback_data: "cmd_survey" }, { text: "🎂 Birthdays", callback_data: "cmd_birthdays" }],
            [{ text: "🔍 Runner Lookup", callback_data: "cmd_lookup_start" }, { text: "📣 Broadcast", callback_data: "cmd_broadcast_start" }],
            [{ text: "📈 Growth Graph", callback_data: "cmd_growth" }, { text: "🚫 Cancel a Run", callback_data: "cmd_cancel_list" }],
            [{ text: "🗑️ Delete a Run", callback_data: "cmd_delete_list" }, { text: "🆕 Create New Run", callback_data: "create_step1" }]
        ]
    });
}

// ─── GROWTH GRAPH ─────────────────────────────────────────────────────────────
async function handleGrowthGraph(chatId) {
    await sendMessage(chatId, "📈 Generating growth graph...");
    const users = await dbGet('stride_users');
    if (!users || users.length === 0) { await sendMessage(chatId, "❌ No members yet."); return; }

    // Group by month using created_at
    const monthCounts = {};
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    users.forEach(u => {
        const date = u.created_at || u.registered_at;
        if (!date) return;
        const d = new Date(date);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        monthCounts[key] = (monthCounts[key] || 0) + 1;
    });

    const keys = Object.keys(monthCounts).sort();
    if (keys.length === 0) { await sendMessage(chatId, "❌ No registration dates found."); return; }

    const labels = keys.map(k => {
        const [y, m] = k.split('-');
        return `${monthNames[parseInt(m)-1]} '${y.slice(2)}`;
    });
    let cumulative = 0;
    const data = keys.map(k => { cumulative += monthCounts[k]; return cumulative; });
    const newThisMonth = monthCounts[keys[keys.length-1]] || 0;
    const totalMembers = data[data.length-1];

    const chartConfig = {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Total Members',
                data,
                borderColor: '#7c6ffa',
                backgroundColor: 'rgba(88,74,220,0.15)',
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#ff9e6d',
                pointBorderColor: '#ff9e6d',
                pointRadius: 6,
                borderWidth: 3
            }]
        },
        options: {
            plugins: {
                legend: { display: false },
                title: { display: true, text: '🏃 Stride Rite — Community Growth', color: '#ffffff', font: { size: 16, weight: 'bold' } }
            },
            scales: {
                y: { beginAtZero: true, ticks: { color: '#a1a1aa', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.08)' } },
                x: { ticks: { color: '#a1a1aa' }, grid: { display: false } }
            }
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
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs scheduled."); return; }
    const nextRun = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');
    let males = 0, females = 0, totalAge = 0;
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) { u.gender === 'Male' ? males++ : females++; totalAge += calculateAge(u.birthdate || '') || (parseInt(u.age) || 0); }
    });
    const avgAge = regs.length > 0 ? Math.round(totalAge / regs.length) : 0;
    const dt = nextRun.date_label.includes('||') ? nextRun.date_label.split('||')[0] : nextRun.date_label;
    await sendMessage(chatId, `📊 *Next Run Stats*\n📍 ${dt}\n\n👥 *Total RSVPs:* ${regs.length}\n🤸 *Gender:* ${males}M / ${females}F\n⏰ *Avg Age:* ${avgAge} years`);
}

// ─── LIST RUNS ────────────────────────────────────────────────────────────────
async function handleListRuns(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs scheduled."); return; }
    let msg = `📋 *All Scheduled Runs (${runs.length}):*\n\n`;
    runs.forEach((r, i) => {
        const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        const cancelled = r.is_cancelled ? ' 🚫 CANCELLED' : '';
        msg += `*${i + 1}.* ${dt}${cancelled}\n`;
    });
    await sendMessage(chatId, msg);
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
async function handleExport(chatId) {
    await sendMessage(chatId, "⏳ Generating...");
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs."); return; }
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
    const dt = nextRun.date_label.includes('||') ? nextRun.date_label.split('||')[0] : nextRun.date_label;
    await sendDocument(chatId, csv, `Stride_Rite_${dt.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
}

// ─── WHATSAPP BLAST ───────────────────────────────────────────────────────────
async function handleBlast(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs scheduled."); return; }
    const r = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${r.id}`);
    const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
    const registered = regs.length > 0 ? `✅ *${regs.length} runner${regs.length > 1 ? 's' : ''} already registered!*` : '';
    await sendMessage(chatId, `📲 *Copy & paste into WhatsApp:*\n\n🏃‍♂️ Stride Rite Community Run 🏃‍♀️\n\n📅 ${dt}\n📍 ${r.location}\n🗺️ ${r.location_link}\n\n${registered}\n\nDon't miss it! Register 👇\n${SITE_URL}\n\n_Every pace is welcome. See you there!_ 💪`);
}

// ─── SURVEY ───────────────────────────────────────────────────────────────────
async function handleSurvey(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs found."); return; }
    const dt = runs[0].date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0].date_label;
    const url = `${SITE_URL}/survey.html?run=${encodeURIComponent(dt)}`;
    await sendMessage(chatId, `📝 *Post-Run Survey:*\n\n🏃 Hey Striders!\n\nHow did today's run feel? Tell us in 30 seconds 👇\n\n${url}\n\nThank you! See you next time 🙌`);
}

// ─── RUNNER LOOKUP ────────────────────────────────────────────────────────────
async function handleLookupStart(chatId) {
    await setSession('waiting_lookup_name');
    await sendMessage(chatId, "🔍 *Runner Lookup*\n\nType the runner's name (or part of it) and I'll find them:");
}

async function handleLookup(chatId, query) {
    await clearSession();
    const users = await dbGet('stride_users');
    const matches = (users || []).filter(u => u.name.toLowerCase().includes(query.toLowerCase()));
    if (matches.length === 0) { await sendMessage(chatId, `❌ No runner found matching "*${query}*"`); return; }

    for (const u of matches.slice(0, 3)) {
        const allRegs = await dbGet('stride_registrations', `user_id=eq.${u.id}`);
        const allRuns = await dbGet('stride_runs');
        const age = u.birthdate ? calculateAge(u.birthdate) : (u.age || '?');
        const birthStr = u.birthdate ? new Date(u.birthdate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Not provided';
        let history = '';
        if (allRegs && allRegs.length > 0) {
            history = allRegs.map(r => {
                const run = (allRuns || []).find(rr => rr.id === r.run_id);
                const label = run ? (run.date_label.includes('||') ? run.date_label.split('||')[0] : run.date_label) : 'Past run';
                return `  • ${label} — ${r.distance}`;
            }).join('\n');
        }
        await sendMessage(chatId,
`👤 *${u.name}*
📧 ${u.email}
🎂 ${birthStr} (Age ${age})
⚧️ ${u.gender}
🏃 ${u.level}

📋 *Run History (${allRegs ? allRegs.length : 0} runs):*
${history || '  No runs yet'}` );
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

👆 Copy the emails above and paste into BCC in Gmail, or tap the link below to open Gmail directly (on phone, tap & hold → open in browser):
${mailtoLink}`);
}

// ─── CANCEL RUN ───────────────────────────────────────────────────────────────
async function handleCancelList(chatId) {
    const runs = await dbGet('stride_runs');
    const active = (runs || []).filter(r => !r.is_cancelled);
    if (active.length === 0) { await sendMessage(chatId, "❌ No active runs to cancel."); return; }
    const buttons = active.map((r, i) => {
        const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        return [{ text: `🚫 ${i + 1}. ${dt}`, callback_data: `cancel_pick_${r.id}` }];
    });
    buttons.push([{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🚫 *Which run do you want to cancel?*", { inline_keyboard: buttons });
}

async function handleCancelPick(chatId, runId) {
    await setSession('waiting_cancel_reason', { runId });
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    const dt = runs[0]?.date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0]?.date_label;
    await sendMessage(chatId, `🚫 *Cancel: ${dt}*\n\nPlease type the reason for cancellation:\n(e.g., "Bad weather", "Venue unavailable")`);
}

async function handleCancelExecute(chatId, runId, reason) {
    await clearSession();
    await dbPatch('stride_runs', 'id', runId, { is_cancelled: true, cancel_reason: reason });

    // Notify all registered runners via their emails (compile list)
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

Suggested cancellation message:

_Hey Striders! Unfortunately the ${dt} run has been cancelled due to ${reason}. We apologize for the inconvenience and look forward to seeing you at the next run! 💪_`);
}

// ─── DELETE LIST ──────────────────────────────────────────────────────────────
async function handleDeleteList(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs to delete."); return; }
    const buttons = runs.map((r, i) => {
        const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        return [{ text: `${i + 1}. ${dt}`, callback_data: `cmd_delete_confirm_${r.id}` }];
    });
    buttons.push([{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🗑️ *Which run do you want to delete?*", { inline_keyboard: buttons });
}

async function handleDeleteConfirmOne(chatId, runId) {
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ Run not found."); return; }
    const dt = runs[0].date_label.includes('||') ? runs[0].date_label.split('||')[0] : runs[0].date_label;
    await sendMessage(chatId, `⚠️ *Delete "${dt}"?*\n\nThis removes all registrations too!`, {
        inline_keyboard: [
            [{ text: "✅ Yes, Delete", callback_data: `cmd_delete_execute_${runId}` }],
            [{ text: "❌ Cancel", callback_data: "cmd_delete_list" }]
        ]
    });
}

// ─── CREATE FLOW ──────────────────────────────────────────────────────────────
async function createStep1(chatId) {
    await clearSession();
    const amHours = [4,5,6,7,8,9,10,11].map(h => ({ text: `${h} AM`, callback_data: `create_hour_${String(h).padStart(2,'0')}` }));
    const pmHours = [1,2,3,4,5,6,7,8,9,10,11].map(h => ({ text: `${h} PM`, callback_data: `create_hour_${String(h+12).padStart(2,'0')}` }));
    const special = [{ text: "12 PM", callback_data: "create_hour_12" }, { text: "12 AM", callback_data: "create_hour_00" }];
    const rows = [];
    for (let i = 0; i < amHours.length; i += 4) rows.push(amHours.slice(i, i+4));
    rows.push(special);
    for (let i = 0; i < pmHours.length; i += 4) rows.push(pmHours.slice(i, i+4));
    rows.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "🆕 *Create New Run — Step 1/5*\n\n⏰ What *hour* will the run start?", { inline_keyboard: rows });
}

async function createStep1b(chatId, hour) {
    await setSession('picking_minutes', { hour });
    const h = parseInt(hour);
    const label = h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h-12} PM`;
    await sendMessage(chatId, `✅ Hour: *${label}*\n\n⏱️ *Minutes?*`, {
        inline_keyboard: [
            [{ text: ":00 (Sharp)", callback_data: "create_min_00" }, { text: ":30", callback_data: "create_min_30" }],
            [{ text: "↩️ Back", callback_data: "create_step1" }]
        ]
    });
}

async function createStep2(chatId, hour, min) {
    await setSession('picking_date', { time: `${hour}:${min}` });
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const days = [];
    for (let i = 1; i <= 21; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        days.push({ text: `${dayNames[d.getDay()]} ${monthNames[d.getMonth()]} ${d.getDate()}`, callback_data: `create_date_${d.toISOString().split('T')[0]}` });
    }
    const rows = [];
    for (let i = 0; i < days.length; i += 2) rows.push(days.slice(i, i+2));
    rows.push([{ text: "↩️ Back", callback_data: "create_step1" }]);
    await sendMessage(chatId, `✅ Time: *${formatTime(`${hour}:${min}`)}*\n\n*Step 2/5* — 📅 Pick the run date:`, { inline_keyboard: rows });
}

async function createStep3(chatId, date, sessionData) {
    await setSession('waiting_maps_link', { ...sessionData, date });
    const d = new Date(date);
    const label = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    await sendMessage(chatId, `✅ *${label}* at *${formatTime(sessionData.time)}*\n\n*Step 3/5* — 📍 Send the *Google Maps link* for the location:`);
}

async function createStep4(chatId, mapsLink, sessionData) {
    await setSession('waiting_location_name', { ...sessionData, mapsLink });
    await sendMessage(chatId, `✅ Maps link saved!\n\n*Step 4/5* — 🏷️ What's the *location name?*\nExample: _Gateway Mall, Al Rehab City_`);
}

async function createConfirm(chatId, locationName, sessionData) {
    const fullData = { ...sessionData, locationName };
    await setSession('confirming', fullData);
    const dateObj = new Date(`${fullData.date}T${fullData.time}`);
    const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    await sendMessage(chatId,
        `📋 *Step 5/5 — Confirm New Run*\n\n📅 *${fd}*\n⏰ *${formatTime(fullData.time)}*\n📍 *${fullData.locationName}*\n🗺️ ${fullData.mapsLink}\n\nLooks good?`,
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
        await dbInsert('stride_runs', {
            id: crypto.randomUUID(), date_label: `${fd} - ${ft}||${dateObj.toISOString()}`,
            location: d.locationName, location_link: d.mapsLink,
            description: 'Every pace is welcome!', created_by: 'admin-1'
        });
        await clearSession();
        await sendMessage(chatId, `🎉 *Run Created!*\n\n📅 ${fd}\n⏰ ${ft}\n📍 ${d.locationName}\n\nLive on the site now! 🚀`);
        await sendMenu(chatId, "What else do you want to do?");
    } catch(e) {
        await sendMessage(chatId, "❌ Something went wrong. Try again from the menu.");
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
            else if (data === 'cmd_survey') await handleSurvey(chatId);
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

        // Multi-step session handling
        if (session.state === 'waiting_maps_link') {
            await createStep4(chatId, text, session.data);
        } else if (session.state === 'waiting_location_name') {
            await createConfirm(chatId, text, session.data);
        } else if (session.state === 'waiting_lookup_name') {
            await handleLookup(chatId, text);
        } else if (session.state === 'waiting_broadcast_msg') {
            await handleBroadcast(chatId, text);
        } else if (session.state === 'waiting_cancel_reason') {
            await handleCancelExecute(chatId, session.data.runId, text);
        } else {
            if (cmd === '/start' || cmd === '/help' || cmd === '/menu') await sendMenu(chatId);
            else if (cmd === '/stats') await handleStats(chatId);
            else if (cmd === '/runs') await handleListRuns(chatId);
            else if (cmd === '/export') await handleExport(chatId);
            else if (cmd === '/blast') await handleBlast(chatId);
            else if (cmd === '/survey') await handleSurvey(chatId);
            else if (cmd === '/birthdays') await checkBirthdays(chatId);
            else if (cmd === '/growth') await handleGrowthGraph(chatId);
            else if (cmd === '/lookup') await handleLookupStart(chatId);
            else if (cmd === '/broadcast') await handleBroadcastStart(chatId);
            else if (cmd === '/cancel') await handleCancelList(chatId);
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
