// --- app.js (RESTORED BOT BUTTONS) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW error:', e));
    });
}

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
        if (!res.ok) throw new Error(await res.text());
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
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (e) { return null; }
}

async function dbUpdate(table, matchColumn, matchValue, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, {
            method: 'PATCH',
            headers: defaultHeaders,
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) { return false; }
}

async function dbDelete(table, matchColumn, matchValue) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, {
            method: 'DELETE',
            headers: defaultHeaders
        });
        return res.ok;
    } catch (e) { return false; }
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
        const existing = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}`);
        if (existing && existing.length > 0) return false;
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
        if (!rawRuns) return [];
        const now = new Date();
        const validRuns = [];
        for(const run of rawRuns) {
            if (run.date_label.includes('[EXPORTED]')) continue;
            if(run.date_label.includes('||')) {
                const parts = run.date_label.split('||');
                const runDate = new Date(parts[1]);
                if(runDate < now) { AppService.handleExpiredRun(run.id, parts[0]); continue; }
                run.date_label = parts[0]; 
            }
            validRuns.push(run);
        }
        return validRuns;
    },
    handleExpiredRun: async (runId, displayLabel) => {
        if (displayLabel.includes('[EXPORTED]')) return;
        const participants = await AppService.getParticipantsForRun(runId);
        if (participants.length === 0) {
            await dbUpdate('stride_runs', 'id', runId, { date_label: `[EXPORTED] ${displayLabel}` });
            return;
        }
        let csvContent = "Name,Email,Age,Distance\n";
        participants.forEach(p => { csvContent += `"${p.name}","${p.email}","${p.age}","${p.distance}"\n`; });
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', new Blob([csvContent], {type: 'text/csv'}), `Run_${displayLabel}.csv`);
        formData.append('caption', `🏁 Auto-Export: ${displayLabel}`);
        try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: formData });
            if (res.ok) await dbUpdate('stride_runs', 'id', runId, { date_label: `[EXPORTED] ${displayLabel}` });
        } catch(e) {}
    },
    registerForRun: async (runId, distance, level) => {
        const user = AuthService.getCurrentUser();
        if(!user) return false;
        const newReg = { id: crypto.randomUUID(), run_id: runId, user_id: user.id, distance, level, registered_at: new Date().toISOString() };
        const result = await dbInsert('stride_registrations', newReg);
        if (result) {
            const runDetails = await dbGet('stride_runs', `id=eq.${runId}`);
            if(runDetails && runDetails.length > 0) AppService.sendTelegramAlert(user, distance, level, runDetails[0]);
            return true;
        }
        return false;
    },
    sendTelegramAlert: async (user, distance, level, run) => {
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const age = user.age || calculateAge(user.birthdate);
        const text = `🚨 *New Runner Alert!*\n\n*${user.name}* (${age}) - *${distance}*\n📅 *Run:* ${run.date_label.split('||')[0]}`;
        try { await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }) }); } catch (e) {}
    },
    sendTelegramSuggestion: async (user, text) => {
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const msg = `💡 *Suggestion:* ${user.name}\n\n"${text}"`;
        try { await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' }) }); } catch (e) {}
    },
    getUserRegistrations: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return regs ? regs.map(r => r.run_id) : [];
    },
    getParticipantsForRun: async (runId) => {
        const regs = await dbGet('stride_registrations', `run_id=eq.${runId}`);
        const users = await dbGet('stride_users'); 
        if(!regs) return [];
        return regs.map(r => {
            const user = users.find(u => u.id === r.user_id);
            return { name: user?.name || 'Unknown', email: user?.email || '', age: user?.age || '', distance: r.distance || '' };
        });
    },
    getPastUserRuns: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        if (!regs) return [];
        const allRuns = await dbGet('stride_runs');
        return regs.map(reg => {
            const run = allRuns.find(r => r.id === reg.run_id);
            if (!run) return null;
            return { ...run, date_display: run.date_label.replace('[EXPORTED] ', '').split('||')[0], user_distance: reg.distance, user_level: reg.level, is_completed: run.date_label.includes('[EXPORTED]') };
        }).filter(r => r !== null && r.is_completed);
    },
    getUserStats: async (userId) => {
        const pastRuns = await AppService.getPastUserRuns(userId);
        let totalKms = 0;
        pastRuns.forEach(run => {
            const distStr = run.user_distance || '0K';
            const num = parseFloat(distStr.replace(/[^\d.]/g, ''));
            if (!isNaN(num)) totalKms += num;
        });
        return { totalRuns: pastRuns.length, totalKms: totalKms.toFixed(1), pastRuns };
    },
    getShopStatus: async () => {
        const settings = await dbGet('shop_settings');
        return settings?.[0]?.is_open || false;
    },
    getShopItems: async () => {
        const items = await dbGet('shop_items', 'is_active=eq.true');
        return items || [];
    },
    submitOrder: async (itemId, size, refNumber, phone) => {
        const user = AuthService.getCurrentUser();
        if (!user) return false;
        
        const newOrder = { 
            id: crypto.randomUUID(), 
            user_id: user.id, 
            item_id: itemId, 
            size: size, 
            receipt_ref: refNumber, 
            phone_number: phone, 
            status: 'pending' 
        };
        
        const result = await dbInsert('shop_orders', newOrder);
        if (result) {
            const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
            const chatId = '1538316434';
            
            // Fetch name for alert
            const items = await dbGet('shop_items', `id=eq.${itemId}`);
            const itemName = items?.[0]?.name || 'Gear Item';
            
            const text = `🛍️ *New VIP Shop Order!*\n\n*Name:* ${user.name}\n*Item:* ${itemName}\n*Size:* ${size}\n*Phone:* ${phone}\n*Ref:* \`${refNumber}\``;
            
            const replyMarkup = {
                inline_keyboard: [
                    [
                        { text: "✅ Approve", callback_data: `shop_appr_${newOrder.id}` },
                        { text: "❌ Reject", callback_data: `shop_rej_${newOrder.id}` }
                    ]
                ]
            };

            try { 
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ 
                        chat_id: chatId, 
                        text, 
                        parse_mode: 'Markdown',
                        reply_markup: replyMarkup
                    }) 
                }); 
            } catch (e) {}
            return true;
        }
        return false;
    }
};

window.AuthService = AuthService;
window.AppService = AppService;
