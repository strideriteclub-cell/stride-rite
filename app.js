// [FILE]: app.js (TRUE COMPLETE VERSION)
// This version includes the Mobile Menu, Animations, and all Features.

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW error:', e)); });
}

const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

async function dbGet(table, query = 'select=*') {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        return res.ok ? await res.json() : [];
    } catch (e) { return []; }
}

async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: defaultHeaders, body: JSON.stringify(data) });
        if (!res.ok) { console.error('DB Error:', await res.json()); return null; }
        const json = await res.json();
        return Array.isArray(json) ? json[0] : json;
    } catch (e) { return null; }
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
    register: async (name, email, password, birthdate, gender, level) => {
        const newUser = { id: crypto.randomUUID(), name, email, password, birthdate, gender, level, joined_at: new Date().toISOString() };
        const result = await dbInsert('stride_users', newUser);
        if (result) { localStorage.setItem("stride_current_user", JSON.stringify(result)); return true; }
        return false;
    },
    logout: () => { localStorage.removeItem("stride_current_user"); window.location.href = 'index.html'; },
    getCurrentUser: () => JSON.parse(localStorage.getItem("stride_current_user") || 'null')
};

const AppService = {
    getRuns: async () => await dbGet('stride_runs'),
    registerForRun: async (runId, dist) => {
        const user = AuthService.getCurrentUser();
        if (!user) return false;
        const result = await dbInsert('stride_registrations', { id: crypto.randomUUID(), run_id: runId, user_id: user.id, distance: dist, level: user.level || 'Intermediate' });
        return result !== null;
    },
    getUserRegistrations: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return regs.map(r => r.run_id);
    },
    getShopItems: async () => await dbGet('shop_items', 'is_active=eq.true'),
    submitOrder: async (itemId, size, phone, method, detail, photoFile) => {
        const user = AuthService.getCurrentUser();
        if (!user) return false;
        const result = await dbInsert('shop_orders', { id: crypto.randomUUID(), user_id: user.id, item_id: itemId, size, payment_method: method, payment_detail: detail, phone_number: phone, status: 'pending' });
        if (result) {
            (async () => {
                const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
                const chatId = '1538316434';
                const cap = `🛒 *New Order!*\n👤 Runner: ${user.name}\n👟 Item ID: ${itemId}`;
                try {
                    if (photoFile) {
                        const fd = new FormData(); fd.append('chat_id', chatId); fd.append('photo', photoFile); fd.append('caption', cap);
                        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: fd });
                    } else {
                        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: cap, parse_mode: 'Markdown' }) });
                    }
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
        let startTimestamp = null;
        const step = (timestamp) => {
            if (!startTimestamp) startTimestamp = timestamp;
            const progress = Math.min((timestamp - startTimestamp) / duration, 1);
            el.innerText = Math.floor(progress * (end - start) + start);
            if (progress < 1) window.requestAnimationFrame(step);
        };
        window.requestAnimationFrame(step);
    }
};

// --- MOBILE NAVIGATION INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    const navLinks = document.querySelector('.nav-links');
    
    const btn = document.createElement('button');
    btn.className = 'hamburger-btn';
    btn.innerHTML = '<span></span><span></span><span></span>';
    navbar.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.className = 'mobile-nav-overlay';
    document.body.appendChild(overlay);

    const panel = document.createElement('nav');
    panel.className = 'mobile-nav-panel';
    panel.innerHTML = navLinks ? navLinks.innerHTML : '';
    document.body.appendChild(panel);

    const toggle = () => { [btn, overlay, panel].forEach(el => el.classList.toggle('open')); document.body.style.overflow = btn.classList.contains('open') ? 'hidden' : ''; };
    btn.onclick = toggle; overlay.onclick = toggle;
    panel.querySelectorAll('a').forEach(a => a.onclick = toggle);
});

window.AuthService = AuthService; window.AppService = AppService; window.Utils = Utils;
