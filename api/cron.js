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

async function dbGet(table, query = 'select=*') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: dbHeaders });
    return await res.json();
}
async function dbUpsert(table, data) {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...dbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(data)
    });
}

async function sendTelegram(text) {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text, parse_mode: 'Markdown' })
    });
}

async function getSession() {
    const rows = await dbGet('bot_sessions', 'id=eq.admin');
    return rows && rows.length > 0 ? rows[0] : { state: 'idle', data: {} };
}
async function setSessionData(key, value) {
    const session = await getSession();
    const newData = { ...(session.data || {}), [key]: value };
    await dbUpsert('bot_sessions', { id: 'admin', state: session.state, data: newData, updated_at: new Date().toISOString() });
}

export default async function handler(req, res) {
    try {
        const now = new Date();
        const session = await getSession();
        const cronData = session.data?.cron || {};

        // ── 1. 24H REMINDER ──────────────────────────────────────────────────
        const runs = await dbGet('stride_runs');
        for (const run of (runs || [])) {
            if (!run.date_label.includes('||') || run.is_cancelled) continue;
            const runDate = new Date(run.date_label.split('||')[1]);
            const hoursUntil = (runDate - now) / (1000 * 60 * 60);
            const alreadySent = cronData[`reminder_${run.id}`];
            if (hoursUntil > 0 && hoursUntil <= 25 && !alreadySent) {
                const regs = await dbGet('stride_registrations', `run_id=eq.${run.id}`);
                const dt = run.date_label.split('||')[0];
                const msg =
`⏰ *24H REMINDER — Run Tomorrow!*

📅 *${dt}*
📍 *${run.location}*
👥 *${regs.length} runners registered*

📲 *WhatsApp blast to send:*

🏃‍♂️ Stride Rite Community Run 🏃‍♀️

📅 ${dt}
📍 ${run.location}
🗺️ ${run.location_link}

✅ *${regs.length} runners already registered!*

Don't miss it! Register 👇
${SITE_URL}

_Every pace is welcome. See you there!_ 💪`;
                await sendTelegram(msg);
                await setSessionData('cron', { ...cronData, [`reminder_${run.id}`]: true });
            }
        }

        // ── 2. BIRTHDAY ALERTS ────────────────────────────────────────────────
        const todayKey = `${now.getMonth()}-${now.getDate()}`;
        if (cronData.birthday_checked !== todayKey) {
            const users = await dbGet('stride_users');
            const birthdays = (users || []).filter(u => {
                if (!u.birthdate) return false;
                const b = new Date(u.birthdate);
                return b.getMonth() === now.getMonth() && b.getDate() === now.getDate();
            });
            if (birthdays.length > 0) {
                const names = birthdays.map(u => `🎂 *${u.name}* (turns ${calculateAge(u.birthdate)}!)`).join('\n');
                await sendTelegram(`🎉 *Birthday Alert!*\n\nToday is the birthday of:\n\n${names}\n\nLet's celebrate our runners! 🎊`);
            }
            await setSessionData('cron', { ...cronData, birthday_checked: todayKey });
        }

        // ── 3. MONTHLY AUTO-REPORT ────────────────────────────────────────────
        const monthKey = `${now.getFullYear()}-${now.getMonth()}`;
        if (now.getDate() === 1 && cronData.monthly_report !== monthKey) {
            const users = await dbGet('stride_users');
            const allRuns = await dbGet('stride_runs');
            const allRegs = await dbGet('stride_registrations');
            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const lastMonth = months[now.getMonth() === 0 ? 11 : now.getMonth() - 1];
            const totalRunners = (users || []).length;
            const totalRuns = (allRuns || []).length;
            const totalRSVPs = (allRegs || []).length;
            const avgPerRun = totalRuns > 0 ? Math.round(totalRSVPs / totalRuns) : 0;
            const genderM = (users || []).filter(u => u.gender === 'Male').length;
            const genderF = (users || []).filter(u => u.gender === 'Female').length;
            await sendTelegram(
`📊 *Monthly Report — ${lastMonth}*

👥 *Total Members:* ${totalRunners}
🏃 *Total Runs Held:* ${totalRuns}
📋 *Total RSVPs Ever:* ${totalRSVPs}
📈 *Avg Runners/Run:* ${avgPerRun}
🤸 *Gender Split:* ${genderM}M / ${genderF}F

Keep growing Stride Rite! 💪🏃‍♂️`
            );
            await setSessionData('cron', { ...cronData, monthly_report: monthKey });
        }

        res.status(200).json({ ok: true });
    } catch(e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
}
