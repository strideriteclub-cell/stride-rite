const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = { 
    'apikey': SUPABASE_KEY, 
    'Authorization': `Bearer ${SUPABASE_KEY}`, 
    'Content-Type': 'application/json', 
    'Prefer': 'return=representation' 
};

async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: defaultHeaders, body: JSON.stringify(data) });
        return res.ok ? (await res.json())[0] : null;
    } catch (e) { return null; }
}

async function dbGet(table, query = 'select=*') {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        return res.ok ? await res.json() : [];
    } catch (e) { return []; }
}

const AuthService = {
    login: async (email, password) => {
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            const admin = { id: 'admin-id', name: 'Admin Haleem', is_admin: true };
            localStorage.setItem("stride_current_user", JSON.stringify(admin));
            return true;
        }
        const users = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}`);
        if (users.length > 0) { localStorage.setItem("stride_current_user", JSON.stringify(users[0])); return true; }
        return false;
    },
    register: async (name, email, p, b, g, l) => {
        const res = await dbInsert('stride_users', { id: crypto.randomUUID(), name, email, password: p, birthdate: b, gender: g, level: l });
        if (res) { localStorage.setItem("stride_current_user", JSON.stringify(res)); return true; }
        return false;
    },
    logout: () => { localStorage.removeItem("stride_current_user"); window.location.href = 'index.html'; },
    getCurrentUser: () => JSON.parse(localStorage.getItem("stride_current_user") || 'null')
};

const AppService = {
    getRuns: async () => await dbGet('stride_runs'),
    registerForRun: async (runId, dist) => {
        const u = AuthService.getCurrentUser();
        return u ? (await dbInsert('stride_registrations', { id: crypto.randomUUID(), run_id: runId, user_id: u.id, distance: dist, level: u.level })) !== null : false;
    },
    getUserRegistrations: async (userId) => (await dbGet('stride_registrations', `user_id=eq.${userId}`)).map(r => r.run_id),
    getShopItems: async () => await dbGet('shop_items', 'is_active=eq.true'),
    submitOrder: async (itemId, size, phone, method, detail, photoFile) => {
        const user = AuthService.getCurrentUser();
        if (!user) return false;
        const orderId = crypto.randomUUID();
        const res = await dbInsert('shop_orders', { id: orderId, user_id: user.id, item_id: itemId, size, payment_method: method, payment_detail: detail, phone_number: phone, status: 'pending' });
        if (res) {
            (async () => {
                const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
                const chatId = '1538316434';
                const items = await dbGet('shop_items', `id=eq.${itemId}`);
                const itemName = items.length > 0 ? items[0].name : "Item";
                const itemPrice = items.length > 0 ? items[0].price : "---";
                const cap = `🛍️ *New VIP Shop Order!*\n\n` +
                            `👤 *Runner:* ${user.name}\n` +
                            `💳 *Method:* ${method}\n` +
                            `📝 *${method} Username:* ${detail}\n` +
                            `📞 *WhatsApp Phone:* ${phone}\n\n` +
                            `👟 *Item:* ${itemName}\n` +
                            `📏 *Size:* ${size}\n` +
                            `💰 *Price:* ${itemPrice} EGP\n\n` +
                            `✅ *Approve or Reject below:*`;

                const markup = { inline_keyboard: [[{ text: "✅ Approve", callback_data: `shop_appr_${orderId}` }, { text: "❌ Reject", callback_data: `shop_rej_${orderId}` }]] };
                
                try {
                    const fd = new FormData(); fd.append('chat_id', chatId); fd.append('caption', cap); fd.append('parse_mode', 'Markdown'); fd.append('reply_markup', JSON.stringify(markup));
                    if (photoFile) { fd.append('photo', photoFile); await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: fd }); }
                    else { await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: cap, parse_mode: 'Markdown', reply_markup: markup }) }); }
                } catch (e) {}
            })();
            return true;
        }
        return false;
    }
};

const Utils = {
    animateNumber: (el, start, end, duration = 1000) => {
        if (!el) return;
        let s = null;
        const step = (t) => {
            if (!s) s = t;
            const p = Math.min((t - s) / duration, 1);
            el.innerText = Math.floor(p * (end - start) + start);
            if (p < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.querySelector('.navbar');
    const navLinks = document.querySelector('.nav-links');
    if (!navbar || !navLinks) return;
    const btn = document.createElement('button'); btn.className = 'hamburger-btn'; btn.innerHTML = '<span></span><span></span><span></span>'; navbar.appendChild(btn);
    const overlay = document.createElement('div'); overlay.className = 'mobile-nav-overlay'; document.body.appendChild(overlay);
    const panel = document.createElement('nav'); panel.className = 'mobile-nav-panel'; panel.innerHTML = navLinks.innerHTML; document.body.appendChild(panel);
    const toggle = () => { [btn, overlay, panel].forEach(el => el.classList.toggle('open')); document.body.style.overflow = btn.classList.contains('open') ? 'hidden' : ''; };
    btn.onclick = toggle; overlay.onclick = toggle; panel.querySelectorAll('a').forEach(a => a.onclick = toggle);
});

window.AuthService = AuthService; window.AppService = AppService; window.Utils = Utils;
