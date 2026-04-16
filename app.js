// --- PWA SERVICE WORKER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW error:', e));
    });
}

// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = {
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
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        return await res.json();
    } catch (e) { return []; }
}

async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: defaultHeaders,
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (e) { return null; }
}

const KEYS = { SESSION: "stride_current_user" };

const AuthService = {
    login: async (email, password) => {
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            const adminUser = { id: 'admin-1', name: 'Admin Haleem', email: 'tsmhaleem@gmail.com', is_admin: true };
            localStorage.setItem(KEYS.SESSION, JSON.stringify(adminUser));
            return true;
        }
        const users = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}`);
        if (users && users.length > 0) {
            localStorage.setItem(KEYS.SESSION, JSON.stringify(users[0]));
            return true;
        }
        return false;
    },
    register: async (name, email, password, birthdate, gender, level) => {
        const newUser = { id: crypto.randomUUID(), name, email, password, birthdate, age: calculateAge(birthdate), gender, level, is_admin: false };
        const inserted = await dbInsert('stride_users', newUser);
        if (inserted) {
            localStorage.setItem(KEYS.SESSION, JSON.stringify(newUser));
            return true;
        }
        return false;
    },
    logout: () => { localStorage.removeItem(KEYS.SESSION); window.location.href = 'index.html'; },
    getCurrentUser: () => localStorage.getItem(KEYS.SESSION) ? JSON.parse(localStorage.getItem(KEYS.SESSION)) : null
};

const AppService = {
    getRuns: async () => {
        const rawRuns = await dbGet('stride_runs');
        return (rawRuns || []).filter(r => !r.date_label.includes('[EXPORTED]'));
    },
    registerForRun: async (runId, distance, level) => {
        const user = AuthService.getCurrentUser();
        const newReg = { id: crypto.randomUUID(), run_id: runId, user_id: user.id, distance, level, registered_at: new Date().toISOString() };
        return await dbInsert('stride_registrations', newReg);
    },
    getUserRegistrations: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return regs.map(r => r.run_id);
    },
    getUserStats: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return { totalRuns: regs.length, totalKms: (regs.length * 5).toFixed(1), pastRuns: [] };
    },
    getShopItems: async () => await dbGet('shop_items', 'is_active=eq.true'),
    
    // --- ADVANCED ORDER SUBMISSION ---
    submitOrder: async (itemId, size, phone, method, detail, photoFile) => {
        const user = AuthService.getCurrentUser();
        if (!user) return false;

        const orderId = crypto.randomUUID();
        const newOrder = {
            id: orderId,
            user_id: user.id,
            item_id: itemId,
            size: size,
            payment_method: method,
            payment_detail: detail,
            phone_number: phone,
            status: 'pending'
        };

        const result = await dbInsert('shop_orders', newOrder);
        if (result) {
            const items = await dbGet('shop_items', `id=eq.${itemId}`);
            const itemName = items.length ? items[0].name : 'Item';
            const price = items.length ? items[0].price : '?';

            const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
            const chatId = '1538316434';
            
            const caption = `🛍️ *New VIP Shop Order!*\n\n*Runner:* ${user.name}\n*Method:* ${method}\n${method === 'telda' ? `*telda Username:* @${detail.replace('@','')}` : `*instapay Phone:* ${detail}`}\n*whatsapp Phone:* ${phone}\n\n*Item:* ${itemName}\n*Size:* ${size}\n*Price:* ${price} EGP`;
            
            const replyMarkup = JSON.stringify({
                inline_keyboard: [[
                    { text: "✅ Approve", callback_data: `shop_appr_${orderId}` },
                    { text: "❌ Reject", callback_data: `shop_rej_${orderId}` }
                ]]
            });

            try {
                if (photoFile) {
                    const formData = new FormData();
                    formData.append('chat_id', chatId);
                    formData.append('photo', photoFile);
                    formData.append('caption', caption);
                    formData.append('parse_mode', 'Markdown');
                    formData.append('reply_markup', replyMarkup);
                    await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: formData });
                } else {
                    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: 'Markdown', reply_markup: JSON.parse(replyMarkup) })
                    });
                }
                return true;
            } catch (e) { console.error('Bot error:', e); return true; }
        }
        return false;
    }
};

window.AuthService = AuthService;
window.AppService = AppService;
