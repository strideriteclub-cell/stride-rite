// [FILE]: api/telegram-webhook.js (COMPLETE VERSION)
// Now handles Location updates AND Order Buttons.

const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';
const ADMIN_CHAT_ID = 1538316434;

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const update = req.body;

    // --- 1. HANDLE BUTTON CLICKS (CALLBACK QUERIES) ---
    if (update.callback_query) {
        const cb = update.callback_query;
        const [type, action, orderId] = cb.data.split('_'); // Format: shop_appr_UUID

        if (type === 'shop') {
            const newStatus = action === 'appr' ? 'approved' : 'rejected';
            try {
                // Update Supabase Order Status
                await fetch(`${SUPABASE_URL}/rest/v1/shop_orders?id=eq.${orderId}`, {
                    method: 'PATCH',
                    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: newStatus })
                });

                // Notify Telegram that it worked
                return res.status(200).json({ 
                    method: 'editMessageCaption', // Or editMessageText
                    chat_id: cb.message.chat.id,
                    message_id: cb.message.message_id,
                    caption: (cb.message.caption || cb.message.text) + `\n\n📢 *Status Updated: ${newStatus.toUpperCase()}*`,
                    parse_mode: 'Markdown'
                });
            } catch (e) { return res.status(500).json({ error: e.message }); }
        }
    }

    // --- 2. HANDLE LOCATION & COMMANDS ---
    const msg = update.edited_message || update.message;
    if (!msg) return res.status(200).json({ status: 'ignored' });

    if (msg.text === '/stoplive' && msg.chat.id === ADMIN_CHAT_ID) {
        await fetch(`${SUPABASE_URL}/rest/v1/stride_live_status?id=eq.1`, {
            method: 'PATCH',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_live: false, updated_at: new Date().toISOString() })
        });
        return res.status(200).json({ status: 'live_stopped' });
    }

    if (msg.location && msg.chat.id === ADMIN_CHAT_ID) {
        const { latitude, longitude } = msg.location;
        await fetch(`${SUPABASE_URL}/rest/v1/stride_live_status?id=eq.1`, {
            method: 'PATCH',
            headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_live: true, lat: latitude, lng: longitude, updated_at: new Date().toISOString() })
        });
        return res.status(200).json({ status: 'success' });
    }

    return res.status(200).json({ status: 'ignored' });
}
