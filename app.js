// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://qcqyyfnsfyuaaaacddsm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_uXs2e5aPzrIL_M2xsYDmWg_hPOUaG1l';

const defaultHeaders = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function calculateAge(birthdate) {
    if (!birthdate) return '?';
    const birth = new Date(birthdate);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
}

// --- API HELPERS ---
async function dbGet(table, query = 'select=*') {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: defaultHeaders });
        if (!res.ok) throw new Error(await res.text());
        return await res.json();
    } catch (e) {
        console.error(`Error fetching ${table}:`, e);
        return [];
    }
}

async function dbInsert(table, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: defaultHeaders,
            body: JSON.stringify(data)
        });
        if (!res.ok) {
            const errBody = await res.text();
            console.error(`DB Insert Error (${table}):`, errBody);
            window.lastDbError = errBody; // Expose for UI
            throw new Error(errBody);
        }
        if (res.status === 201) {
            const result = await res.json();
            return Array.isArray(result) ? result[0] : (result || true);
        }
        return true;
    } catch (e) {
        console.error(`Catch inserting into ${table}:`, e);
        return null;
    }
}

async function dbUpdate(table, matchColumn, matchValue, data) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, {
            method: 'PATCH',
            headers: defaultHeaders,
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return true;
    } catch (e) {
        console.error(`Error updating ${table}:`, e);
        return false;
    }
}

async function dbDelete(table, matchColumn, matchValue) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${matchColumn}=eq.${matchValue}`, {
            method: 'DELETE', headers: defaultHeaders
        });
        if (!res.ok) throw new Error(await res.text());
        return true;
    } catch (e) {
        console.error(`Error deleting from ${table}:`, e);
        return false;
    }
}

const KEYS = { SESSION: "stride_current_user" };

// --- AUTH LOGIC ---
const AuthService = {
    login: async (email, password) => {
        let userRecord = null;
        if (email === 'tsmhaleem@gmail.com' && password === 'haleem@147') {
            userRecord = { id: 'admin-1', name: 'Admin Haleem', email: 'tsmhaleem@gmail.com', is_admin: true };
        } else {
            const users = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}&password=eq.${encodeURIComponent(password)}`);
            if (users && users.length > 0) userRecord = users[0];
        }

        if (userRecord) {
            localStorage.setItem(KEYS.SESSION, JSON.stringify(userRecord));
            // Sync to DB to ensure FKs work
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/stride_users`, {
                    method: 'POST',
                    headers: { ...defaultHeaders, 'Prefer': 'resolution=merge-duplicates' },
                    body: JSON.stringify(userRecord)
                });
            } catch (e) { console.error("User sync failed", e); }
            return true;
        }
        return false;
    },

    register: async (name, email, password, birthdate, gender, level) => {
        const existing = await dbGet('stride_users', `email=eq.${encodeURIComponent(email)}`);
        if (existing && existing.length > 0) return false;
        const newUser = {
            id: generateUUID(),
            name, email, password,
            birthdate,
            age: calculateAge(birthdate),
            gender, level, is_admin: false
        };
        const inserted = await dbInsert('stride_users', newUser);
        if (inserted) {
            localStorage.setItem(KEYS.SESSION, JSON.stringify(newUser));
            return true;
        }
        return false;
    },

    logout: () => {
        localStorage.removeItem(KEYS.SESSION);
        window.location.href = 'index.html';
    },

    getCurrentUser: () => {
        return localStorage.getItem(KEYS.SESSION) ? JSON.parse(localStorage.getItem(KEYS.SESSION)) : null;
    }
};

// --- APP SERVICE ---
const AppService = {
    getRuns: async () => {
        const rawRuns = await dbGet('stride_runs');
        if (!rawRuns || rawRuns.length === 0) return [];
        const now = new Date();
        const validRuns = [];
        for (const run of rawRuns) {
            if (run.date_label.includes('[EXPORTED]')) continue;
            if (run.date_label && run.date_label.includes('||')) {
                const parts = run.date_label.split('||');
                const runDate = new Date(parts[1]);
                if (runDate < now) {
                    AppService.handleExpiredRun(run.id, parts[0]);
                    continue;
                }
                run.date_label = parts[0];
            }
            validRuns.push(run);
        }
        return validRuns;
    },

    handleExpiredRun: async (runId, displayLabel) => {
        if (displayLabel.includes('[EXPORTED]')) return;
        const verify = await dbGet('stride_runs', `id=eq.${runId}`);
        if (!verify || verify.length === 0) return;
        const participants = await AppService.getParticipantsForRun(runId);
        if (participants.length === 0) {
            await dbUpdate('stride_runs', 'id', runId, { date_label: `[EXPORTED] ${displayLabel}` });
            return;
        }
        let csvContent = "Name,Email,Age,Gender,Distance,Level,Registration Timestamp\n";
        participants.forEach(p => {
            csvContent += `"${p.name}","${p.email}","${p.age}","${p.gender}","${p.distance}","${p.level}","${new Date(p.registeredAt).toLocaleString()}"\n`;
        });
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', new Blob([csvContent], { type: 'text/csv' }), `Run_Export_${displayLabel.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
        formData.append('caption', `🏁 Auto-Export: ${displayLabel}`);
        try {
            const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, { method: 'POST', body: formData });
            if (res.ok) {
                await dbUpdate('stride_runs', 'id', runId, { date_label: `[EXPORTED] ${displayLabel}` });
            }
        } catch (e) { console.error("AutoExport failed", e); }
    },

    registerForRun: async (runId, distance, level) => {
        const currentUser = AuthService.getCurrentUser();
        if (!currentUser) return false;
        const existing = await dbGet('stride_registrations', `run_id=eq.${runId}&user_id=eq.${currentUser.id}`);
        if (existing && existing.length > 0) return false;
        const allRegs = await dbGet('stride_registrations', `user_id=eq.${currentUser.id}`);
        const isFirstTimer = !allRegs || allRegs.length === 0;
        const newRegistration = {
            id: generateUUID(),
            run_id: runId,
            user_id: currentUser.id,
            distance: distance,
            level: level
        };
        const result = await dbInsert('stride_registrations', newRegistration);
        if (result !== null) {
            const runDetails = await dbGet('stride_runs', `id=eq.${runId}`);
            if (runDetails && runDetails.length > 0) {
                AppService.sendTelegramAlert(currentUser, distance, level, runDetails[0], isFirstTimer);
            }
            return true;
        }
        return false;
    },

    sendTelegramAlert: async (user, distance, level, run, isFirstTimer = false) => {
        const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
        const chatId = '1538316434';
        const cleanTimestamp = run.date_label.split('||')[0];
        const age = user.birthdate ? calculateAge(user.birthdate) : (user.age || '?');
        const firstTimerBadge = isFirstTimer ? '\n\n🎉 *FIRST TIMER! Welcome them warmly!*' : '';
        const text = `${isFirstTimer ? '🌟' : '🚨'} *${isFirstTimer ? 'First-Time' : 'New'} Runner Alert!*\n\n*${user.name}* (${age}${user.gender === 'Male' ? 'M' : 'F'}) just registered for the *${distance}*!\n📧 *Email:* ${user.email}\n🏃 *Level:* ${level || user.level}\n📅 *Run:* ${cleanTimestamp}${firstTimerBadge}`;
        try {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
            });
        } catch (e) { console.error('Telegram alert failed', e); }
    },

    getUserRegistrations: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        return regs.map(r => r.run_id);
    },

    getParticipantsForRun: async (runId) => {
        const regs = await dbGet('stride_registrations', `run_id=eq.${runId}`);
        const users = await dbGet('stride_users');
        return regs.map(r => {
            const user = users.find(u => u.id === r.user_id);
            return {
                name: user ? user.name : 'Unknown',
                email: user ? user.email : 'Unknown',
                age: user ? (user.age || 'N/A') : 'N/A',
                gender: user ? (user.gender || 'N/A') : 'N/A',
                distance: r.distance || 'N/A',
                level: r.level || (user ? user.level : 'N/A'),
                registeredAt: r.registered_at
            };
        });
    },

    getPastUserRuns: async (userId) => {
        const regs = await dbGet('stride_registrations', `user_id=eq.${userId}`);
        if (!regs || regs.length === 0) return [];
        const allRuns = await dbGet('stride_runs');
        return regs.map(reg => {
            const run = allRuns.find(r => r.id === reg.run_id);
            if (!run) return null;
            const isExported = run.date_label.includes('[EXPORTED]');
            return {
                ...run,
                date_display: run.date_label.replace('[EXPORTED] ', '').split('||')[0],
                user_distance: reg.distance,
                user_level: reg.level,
                is_completed: isExported
            };
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
        return {
            totalRuns: pastRuns.length,
            totalKms: totalKms.toFixed(1),
            pastRuns: pastRuns
        };
    },

    // --- SHOP ---
    getShopStatus: async () => {
        const settings = await dbGet('shop_settings');
        if (settings && settings.length > 0) return settings[0].is_open;
        return false;
    },

    getShopItems: async () => {
        const items = await dbGet('shop_items', 'is_active=eq.true');
        return items || [];
    },
    submitOrder: async (itemId, size, refNumber, phone) => {
        const currentUser = AuthService.getCurrentUser();
        if (!currentUser) return false;

        const newOrder = {
            id: generateUUID(),
            user_id: currentUser.id,
            item_id: itemId,
            size: size,
            receipt_ref: refNumber,
            phone_number: phone, 
            payment_method: 'InstaPay/Telda', // Added to satisfy DB constraint
            status: 'pending'
        };

        console.log("Submitting order with payment method...", newOrder);
        let result = await dbInsert('shop_orders', newOrder);
        
        // If it fails due to column name mismatch, try common fallbacks
        if (result === null && window.lastDbError) {
            const err = window.lastDbError;
            if (err.includes('receipt_ref') || err.includes('payment_method')) {
                console.log("Retrying with fallback logic...");
                const fallbackOrder = { ...newOrder };
                // Handle various potential missing/renamed columns
                if (err.includes('receipt_ref')) {
                    delete fallbackOrder.receipt_ref;
                    fallbackOrder.reference = refNumber;
                }
                result = await dbInsert('shop_orders', fallbackOrder);
            }
        }
        if (result !== null) {
            const items = await dbGet('shop_items', `id=eq.${itemId}`);
            const itemName = (items && items.length > 0) ? items[0].name : 'Unknown Item';
            const price = (items && items.length > 0) ? items[0].price : 'Unknown';

            const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
            const chatId = '1538316434';
            const text = `🛍️ *New VIP Shop Order!*\n\n*Name:* ${currentUser.name}\n*Email:* ${currentUser.email}\n*Phone:* ${phone}\n*Gender:* ${currentUser.gender || 'N/A'}\n\n*Item:* ${itemName}\n*Size:* ${size}\n*Price:* ${price} EGP\n*Ref #:* \`${refNumber}\``;

            const replyMarkup = {
                inline_keyboard: [
                    [
                        { text: "✅ Approve Order", callback_data: `shop_appr_${newOrder.id}` },
                        { text: "❌ Reject Order", callback_data: `shop_rej_${newOrder.id}` }
                    ]
                ]
            };

            try {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', reply_markup: replyMarkup })
                });
            } catch (e) { console.error("Telegram shop alert failed", e); }
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

// --- HAMBURGER MENU ---
document.addEventListener('DOMContentLoaded', () => {
    const navbar = document.querySelector('.navbar');
    const navLinks = document.querySelector('.nav-links');
    if (!navbar || !navLinks) return;
    const btn = document.createElement('button');
    btn.className = 'hamburger-btn';
    btn.innerHTML = '<span></span><span></span><span></span>';
    navbar.appendChild(btn);
    const overlay = document.createElement('div');
    overlay.className = 'mobile-nav-overlay';
    document.body.appendChild(overlay);
    const panel = document.createElement('nav');
    panel.className = 'mobile-nav-panel';
    panel.innerHTML = navLinks.innerHTML;
    document.body.appendChild(panel);
    const toggle = () => {
        [btn, overlay, panel].forEach(el => el.classList.toggle('open'));
        document.body.style.overflow = btn.classList.contains('open') ? 'hidden' : '';
    };
    btn.onclick = toggle;
    overlay.onclick = toggle;
    panel.querySelectorAll('a').forEach(a => a.onclick = toggle);
});

// Global Exposure
window.AuthService = AuthService;
window.AppService = AppService;
window.Utils = Utils;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;
window.defaultHeaders = defaultHeaders;
