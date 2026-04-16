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
            [{ text: "📈 Growth Graph", callback_data: "cmd_growth" }, { text: "✏️ Edit a Run", callback_data: "cmd_edit_list" }],
            [{ text: "📸 Add to Gallery", callback_data: "cmd_gallery_start" }, { text: "🛍️ VIP Shop Admin", callback_data: "cmd_shop_menu" }],
            [{ text: "🚫 Cancel a Run", callback_data: "cmd_cancel_list" }, { text: "🗑️ Delete a Run", callback_data: "cmd_delete_list" }],
            [{ text: "🆕 Create New Run", callback_data: "create_step1" }]
        ]
    });
}

// ─── GALLERY UPLOAD ──────────────────────────────────────────────────────────
async function handleGalleryStart(chatId) {
    const runs = await dbGet('stride_runs');
    const buttons = (runs || []).map(r => {
        const label = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        return [{ text: `🏃 ${label}`, callback_data: `gallery_run_${encodeURIComponent(label)}` }];
    });
    buttons.unshift([{ text: "📸 General / No specific run", callback_data: "gallery_run_general" }]);
    buttons.push([{ text: "🗑️ Delete a Photo", callback_data: "cmd_gallery_delete" }]);
    buttons.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "📸 *Gallery*\n\nAdd photos — pick which run they're from:", { inline_keyboard: buttons });
}

async function handleGalleryRunPicked(chatId, runLabel) {
    const label = runLabel === 'general' ? '' : decodeURIComponent(runLabel);
    await setSession('waiting_gallery_photo', { runLabel: label });
    const msg = label
        ? `✅ Run: *${label}*\n\n📸 Now *send the photo*! You can add a caption too (just type it in the caption field when sending).\n\nSend one photo at a time.`
        : `📸 *Send the photo now!* You can add a caption too.\n\nSend one photo at a time.`;
    await sendMessage(chatId, msg);
}

async function handleGalleryPhoto(chatId, message, session) {
    const photos = message.photo;
    const fileId = photos[photos.length - 1].file_id;
    const caption = message.caption || '';
    const runLabel = session.data.runLabel || '';

    await sendMessage(chatId, "⏳ Uploading photo...");

    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) { await sendMessage(chatId, "❌ Couldn't get the file from Telegram."); return; }

    const imgRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    if (!imgRes.ok) { await sendMessage(chatId, "❌ Failed to download photo."); return; }
    const imgBuffer = await imgRes.arrayBuffer();

    const fileName = `${Date.now()}.jpg`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${fileName}`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'image/jpeg',
        },
        body: imgBuffer
    });

    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        await sendMessage(chatId, `❌ Storage upload failed: ${errText}`);
        return;
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/gallery/${fileName}`;
    await dbInsert('gallery_photos', { run_label: runLabel || null, photo_url: publicUrl, caption });
    
    // Limits logic removed for clarity, keeps base feature working

    await sendMessage(chatId,
        `✅ *Photo added to gallery!*\n\n🎨 Caption: ${caption || '_none_'}\n🏃 Run: ${runLabel || 'General'}\n\nSend another photo or go back to menu.`,
        { inline_keyboard: [[{ text: "📸 Add Another", callback_data: `gallery_run_${runLabel ? encodeURIComponent(runLabel) : 'general'}` }], [{ text: "↩️ Menu", callback_data: "cmd_menu" }]] }
    );
}

// ─── SHOP ADMIN ──────────────────────────────────────────────────────────────
async function handleShopMenu(chatId) {
    const settings = await dbGet('shop_settings');
    const isShopOpen = (settings && settings.length > 0) ? settings[0].is_open : false;
    
    const statusText = isShopOpen ? "🟢 *OPEN* (Visible to everyone)" : "🔴 *CLOSED* (Hidden, Merch Dropping Soon text)";
    const toggleText = isShopOpen ? "🔴 Hide Shop / Turn Off" : "🟢 Open Shop / Turn On";

    await sendMessage(chatId, `🛍️ *VIP Shop Admin*\n\nCurrent Status: ${statusText}`, {
        inline_keyboard: [
            [{ text: toggleText, callback_data: `shop_toggle_${!isShopOpen}` }],
            [{ text: "📦 Export All Orders (Excel)", callback_data: "cmd_shop_export" }],
            [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]
        ]
    });
}

// Order Actions
async function handleShopOrderApprove(chatId, orderId) {
    await updateOrderStatusAndEmail(chatId, orderId, 'approved', 'template_qgow76l');
}

async function handleShopOrderReject(chatId, orderId) {
    await updateOrderStatusAndEmail(chatId, orderId, 'rejected', 'template_59dgsfw');
}

function formatWhatsAppPhone(phone) {
    if (!phone) return '';
    let p = phone.replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '20' + p.substring(1); 
    return p;
}

async function updateOrderStatusAndEmail(chatId, orderId, newStatus, templateId) {
    await sendMessage(chatId, `⏳ Processing ${newStatus} for order...`);
    
    const orders = await dbGet('shop_orders', `id=eq.${orderId}`);
    if(!orders || orders.length===0) return;
    const order = orders[0];

    const items = await dbGet('shop_items', `id=eq.${order.item_id}`);
    const itemName = (items && items.length>0) ? items[0].name : 'Item';
    const itemPrice = (items && items.length>0) ? items[0].price : '0';

    const users = await dbGet('stride_users', `id=eq.${order.user_id}`);
    const userEmail = (users && users.length>0) ? users[0].email : '';
    const userNameFull = (users && users.length>0) ? users[0].name : 'Runner';
    const userName = userNameFull.split(' ')[0];

    await fetch(`${SUPABASE_URL}/rest/v1/shop_orders?id=eq.${orderId}`, {
        method: 'PATCH',
        headers: dbHeaders,
        body: JSON.stringify({ status: newStatus })
    });

    let emailSent = false;
    try {
        const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: 'service_d2aff6e',
                template_id: templateId,
                user_id: 'GBTxpiwg_SF7bN2tH',
                accessToken: '9yAc3NjCBB5wATwThsv6U',
                template_params: {
                    to_name: userName,
                    to_email: userEmail,
                    price: itemPrice,
                    item_name: itemName,
                    item_size: order.size
                }
            })
        });
        emailSent = emailRes.ok;
    } catch(e) { console.error("Email notification failed", e); }

    const statusEmoji = newStatus === 'approved' ? '✅' : '❌';
    const statusText = newStatus.toUpperCase();
    const waPhone = formatWhatsAppPhone(order.phone_number);
    const waMsgText = `Hey ${userName}! 👋 Your Stride Rite order for the ${itemName} has been ${statusText} ${statusEmoji}.\n\nSee you at the next run! 🏃♂️💨`;
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(waMsgText)}`;

    const replyMarkup = {
        inline_keyboard: [
            [{ text: `📲 Notify ${userName} via WhatsApp`, url: waUrl }],
            [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]
        ]
    };

    let finalMsg = `📦 Order for *${itemName}* marked as *${statusText}* ${statusEmoji}.\n👤 *Runner:* ${userNameFull}`;
    await sendMessage(chatId, finalMsg, replyMarkup);
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
            else if (data === 'cmd_gallery_start') await handleGalleryStart(chatId);
            else if (data.startsWith('shop_appr_')) await handleShopOrderApprove(chatId, data.replace('shop_appr_', ''));
            else if (data.startsWith('shop_rej_')) await handleShopOrderReject(chatId, data.replace('shop_rej_', ''));
            else if (data === 'cmd_shop_menu') await handleShopMenu(chatId);

            res.status(200).send('ok'); return;
        }

        if (body.message && body.message.photo) {
            const chatId = body.message.chat.id.toString();
            if (chatId === ADMIN_CHAT_ID) {
                const session = await getSession();
                if (session.state === 'waiting_gallery_photo') {
                    await handleGalleryPhoto(chatId, body.message, session);
                } 
            }
            res.status(200).send('ok'); return;
        }

        if (!body.message || !body.message.text) { res.status(200).send('ok'); return; }
        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
        const text = body.message.text.trim();
        const cmd = text.split(' ')[0].toLowerCase();
        
        if (cmd === '/start' || cmd === '/help' || cmd === '/menu') await sendMenu(chatId);
        else await sendMenu(chatId, "❓ Unknown command. Use the buttons below!");

        res.status(200).send('ok');
    } catch(e) {
        console.error(e);
        res.status(500).send('Error');
    }
}
