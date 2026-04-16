// [FILE]: api/telegram-webhook.js (STAYS THE SAME)
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const ADMIN_CHAT_ID = 1538316434;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const update = req.body;
    const msg = update.edited_message || update.message;
    if (!msg) return res.status(200).json({ status: 'ignored' });
    if (msg.text === '/stoplive' && msg.chat.id === ADMIN_CHAT_ID) {
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/stride_live_status?id=eq.1`, { method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ is_live: false, updated_at: new Date().toISOString() }) });
            return res.status(200).json({ status: 'live_stopped' });
        } catch (e) { return res.status(500).json({ error: e.message }); }
    }
    if (!msg.location || msg.chat.id !== ADMIN_CHAT_ID) return res.status(200).json({ status: 'ignored' });
    const { latitude, longitude } = msg.location;
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/stride_live_status?id=eq.1`, { method: 'PATCH', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ is_live: true, lat: latitude, lng: longitude, updated_at: new Date().toISOString() }) });
        return res.status(200).json({ status: 'success' });
    } catch (err) { return res.status(500).json({ error: err.message }); }
}
