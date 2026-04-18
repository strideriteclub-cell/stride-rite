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

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
function extractIsoDate(dateLabel) {
    if (!dateLabel || !dateLabel.includes('||')) return null;
    return dateLabel.split('||')[1];
}

async function getSortedUpcomingRuns() {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) return [];
    
    const now = new Date().toISOString();
    
    return runs
        .filter(r => {
            const isoDate = extractIsoDate(r.date_label);
            return isoDate && isoDate >= now;
        })
        .sort((a, b) => {
            const dateA = extractIsoDate(a.date_label);
            const dateB = extractIsoDate(b.date_label);
            return dateA.localeCompare(dateB);
        });
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

// ─── GALLERY ─────────────────────────────────────────────────────────────────
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
        ? `✅ Run: *${label}*\n\n📸 Now *send the photo*! You can add a caption too.\n\nSend one photo at a time.`
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
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg' },
        body: imgBuffer
    });
    if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        await sendMessage(chatId, `❌ Storage upload failed: ${errText}`);
        return;
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/gallery/${fileName}`;
    await dbInsert('gallery_photos', { run_label: runLabel || null, photo_url: publicUrl, caption });
    const allPhotos = await dbGet('gallery_photos', 'order=uploaded_at.asc&select=id,photo_url');
    if (allPhotos && allPhotos.length > 150) {
        const toDelete = allPhotos.slice(0, allPhotos.length - 150);
        for (const old of toDelete) {
            const oldFileName = old.photo_url.split('/public/gallery/')[1];
            if (oldFileName) {
                await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${oldFileName}`, { method: 'DELETE', headers: dbHeaders });
            }
            await fetch(`${SUPABASE_URL}/rest/v1/gallery_photos?id=eq.${old.id}`, { method: 'DELETE', headers: dbHeaders });
        }
    }
    const totalNow = Math.min((allPhotos?.length || 1), 150);
    const autoDeletedMsg = allPhotos && allPhotos.length > 150 ? `\n♻️ _Oldest photo auto-removed to stay within 150 limit_` : '';
    await sendMessage(chatId,
        `✅ *Photo added to gallery!*\n\n🎨 Caption: ${caption || '_none_'}\n🏃 Run: ${runLabel || 'General'}\n📸 Gallery: ${totalNow}/150 photos${autoDeletedMsg}\n\nSend another photo or go back to menu.`,
        { inline_keyboard: [[{ text: "📸 Add Another", callback_data: `gallery_run_${runLabel ? encodeURIComponent(runLabel) : 'general'}` }], [{ text: "↩️ Menu", callback_data: "cmd_menu" }]] }
    );
}

async function handleGalleryDeleteList(chatId) {
    const photos = await dbGet('gallery_photos', 'order=uploaded_at.desc&limit=10');
    if (!photos || photos.length === 0) { await sendMessage(chatId, "❌ No photos in the gallery yet."); return; }
    const buttons = photos.map((p, i) => {
        const label = p.caption || (p.run_label ? `🏃 ${p.run_label}` : `Photo ${i+1}`);
        return [{ text: `🗑️ ${i+1}. ${label.slice(0,40)}`, callback_data: `gallery_del_${p.id}` }];
    });
    buttons.push([{ text: "↩️ Back", callback_data: "cmd_gallery_start" }]);
    await sendMessage(chatId, `🗑️ *Delete a Photo*\n\nThese are the last ${photos.length} photos:`, { inline_keyboard: buttons });
}

async function handleGalleryDeleteConfirm(chatId, photoId) {
    const photos = await dbGet('gallery_photos', `id=eq.${photoId}`);
    if (!photos || photos.length === 0) { await sendMessage(chatId, "❌ Photo not found."); return; }
    const p = photos[0];
    const label = p.caption || p.run_label || 'this photo';
    await sendMessage(chatId, `⚠️ *Delete "${label}"?*\nThis cannot be undone.`, {
        inline_keyboard: [
            [{ text: "✅ Yes, Delete", callback_data: `gallery_del_yes_${photoId}` }],
            [{ text: "❌ Cancel", callback_data: "cmd_menu" }]
        ]
    });
}

async function handleGalleryDeleteExecute(chatId, photoId) {
    const photos = await dbGet('gallery_photos', `id=eq.${photoId}`);
    if (photos && photos.length > 0) {
        const photoUrl = photos[0].photo_url;
        const fileName = photoUrl.split('/public/gallery/')[1];
        if (fileName) {
            await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${fileName}`, { method: 'DELETE', headers: dbHeaders });
        }
        await fetch(`${SUPABASE_URL}/rest/v1/gallery_photos?id=eq.${photoId}`, { method: 'DELETE', headers: dbHeaders });
    }
    await sendMessage(chatId, "✅ *Photo deleted from gallery!*");
    await sendMenu(chatId, "What else?");
}

// ─── SHOP ADMIN ──────────────────────────────────────────────────────────────
async function handleShopMenu(chatId) {
    const settings = await dbGet('shop_settings');
    const isShopOpen = (settings && settings.length > 0) ? settings[0].is_open : false;
    const statusText = isShopOpen ? "🟢 *OPEN* (Visible to everyone)" : "🔴 *CLOSED* (Hidden)";
    const toggleText = isShopOpen ? "🔴 Hide Shop / Turn Off" : "🟢 Open Shop / Turn On";
    await sendMessage(chatId, `🛍️ *Shop Admin*\n\nCurrent Status: ${statusText}`, {
        inline_keyboard: [
            [{ text: toggleText, callback_data: `shop_toggle_${!isShopOpen}` }],
            [{ text: "📦 Export All Orders (Excel)", callback_data: "cmd_shop_export" }],
            [{ text: "👕 Manage Products", callback_data: "cmd_shop_prd_menu" }],
            [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]
        ]
    });
}

async function handleShopToggle(chatId, newStateStr) {
    const newState = newStateStr === "true";
    const settings = await dbGet('shop_settings');
    if (settings && settings.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/shop_settings?id=eq.${settings[0].id}`, {
            method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ is_open: newState })
        });
    } else {
        await dbInsert('shop_settings', { id: crypto.randomUUID(), is_open: newState });
    }
    await sendMessage(chatId, newState ? "✅ Shop is now *LIVE* to the community!" : "🚫 Shop is now *HIDDEN*.");
    await handleShopMenu(chatId);
}

async function handleShopOrderApprove(chatId, orderId, messageId, isPhoto) {
    await updateOrderStatusAndEmail(chatId, orderId, 'approved', 'template_qgow76l', messageId, isPhoto);
}
async function handleShopOrderReject(chatId, orderId, messageId, isPhoto) {
    await updateOrderStatusAndEmail(chatId, orderId, 'rejected', 'template_59dgsfw', messageId, isPhoto);
}

function formatWhatsAppPhone(phone) {
    if (!phone) return '';
    let p = phone.replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '20' + p.substring(1);
    return p;
}

async function updateOrderStatusAndEmail(chatId, orderId, newStatus, templateId, messageId, isPhoto) {
    const orders = await dbGet('shop_orders', `id=eq.${orderId}`);
    if (!orders || orders.length === 0) return;
    const order = orders[0];
    const items = await dbGet('shop_items', `id=eq.${order.item_id}`);
    const item = items[0] || { name: 'Item', price: '0' };
    const users = await dbGet('stride_users', `id=eq.${order.user_id}`);
    const user = users[0] || { name: 'Runner', email: '' };

    await dbPatch('shop_orders', 'id', orderId, { status: newStatus });

    // Send Email notification
    try {
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                service_id: 'service_d2aff6e',
                template_id: templateId,
                user_id: 'GBTxpiwg_SF7bN2tH',
                accessToken: '9yAc3NjCBB5wATwThsv6U',
                template_params: { to_name: user.name, to_email: user.email, price: item.price, item_name: item.name, item_size: order.size }
            })
        });
    } catch (e) { console.error("Email fail", e); }

    const statusEmoji = newStatus === 'approved' ? '✅' : '❌';
    const waPhone = formatWhatsAppPhone(order.phone_number);
    const waUrl = `https://wa.me/${waPhone}?text=${encodeURIComponent(`Hey ${user.name}! Your order for ${item.name} has been ${newStatus} ${statusEmoji}`)}`;

    const text = `${statusEmoji} *ORDER ${newStatus.toUpperCase()}*\n\n👤 *Customer:* ${user.name}\n📧 *Email:* ${user.email}\n📞 *Phone:* ${order.phone_number}\n\n🛍️ *Item:* ${item.name}\n📏 *Size:* ${order.size}\n💰 *Price:* ${item.price} EGP\n\n💳 *Payment Prop:* ${order.payment_method || 'N/A'}\n🔢 *Ref:* \`${order.payment_detail || order.receipt_ref || order.reference || 'N/A'}\`\n\n📅 *Order Date:* ${new Date(order.created_at).toLocaleString()}`;
    
    // Detect if we need to edit a CAPTION (photo message) or TEXT (normal message)
    const method = isPhoto ? 'editMessageCaption' : 'editMessageText';
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "📲 WhatsApp Customer", url: waUrl }], [{ text: "↩️ Back to Menu", callback_data: "cmd_menu" }]] }
    };
    if (isPhoto) payload.caption = text;
    else payload.text = text;

    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

async function handleShopExportOrders(chatId) {
    await sendMessage(chatId, "⏳ Compiling orders...");
    const orders = await dbGet('shop_orders');
    const items = await dbGet('shop_items');
    const users = await dbGet('stride_users');
    let csv = "Date,Customer Name,Phone,Email,Item,Size,Price,Status,Reference Number\n";
    for (const o of (orders || [])) {
        const item = (items || []).find(i => i.id === o.item_id) || {};
        const user = (users || []).find(u => u.id === o.user_id) || {};
        csv += `"${new Date(o.created_at).toLocaleDateString()}","${user.name || 'Unknown'}","${o.phone_number || ''}","${user.email || ''}","${item.name || 'Unknown'}","${o.size}","${item.price || ''}","${o.status}","${o.receipt_ref || o.reference || ''}","${o.payment_method || 'InstaPay/Telda'}"\n`;
    }
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', new Blob([csv], { type: 'text/csv' }), `StrideRite_Shop_Orders.csv`);
    formData.append('caption', `📦 Here is the full list of Shop Orders (${(orders || []).length} total).`);
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: formData });
}

async function handleShopProductMenu(chatId) {
    const items = await dbGet('shop_items');
    const buttons = [];
    (items || []).forEach(item => {
        const icon = item.is_active ? '🟢' : '🔴';
        buttons.push([{ text: `${icon} ${item.name} (${item.price} EGP)`, callback_data: `shop_prd_edit_mn_${item.id}` }]);
    });
    buttons.push([{ text: "➕ Add New Product", callback_data: "cmd_shop_prd_add" }]);
    buttons.push([{ text: "↩️ Back to Shop Admin", callback_data: "cmd_shop_menu" }]);
    await sendMessage(chatId, "👕 *Manage Products*\n\nHere are the items currently in your store:", { inline_keyboard: buttons });
}

async function uploadShopPhoto(chatId, message) {
    const photos = message.photo;
    const fileId = photos[photos.length - 1].file_id;
    await sendMessage(chatId, "⏳ Uploading photo to Shop cloud...");
    const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return null;
    const imgRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
    if (!imgRes.ok) return null;
    const imgBuffer = await imgRes.arrayBuffer();
    const fileName = `shop_${Date.now()}.jpg`;
    const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/gallery/${fileName}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'image/jpeg' },
        body: imgBuffer
    });
    if (!uploadRes.ok) return null;
    return `${SUPABASE_URL}/storage/v1/object/public/gallery/${fileName}`;
}

async function handleShopProductAdd(chatId) {
    await setSession('shop_add_item', { step: 'name' });
    await sendMessage(chatId, "🛍️ *Add New Product (Step 1/4)*\n\nWhat is the name of this product?");
}

async function handleShopProductEditMenu(chatId, productId) {
    const items = await dbGet('shop_items', `id=eq.${productId}`);
    if (!items || items.length === 0) return;
    const item = items[0];
    const statusObj = item.is_active ? { icon: '🔴', text: 'Hide Product', val: false } : { icon: '🟢', text: 'Show Product', val: true };
    const buttons = [
        [{ text: "✏️ Edit Name", callback_data: `shop_prd_upd_name_${item.id}` }],
        [{ text: "✏️ Edit Price", callback_data: `shop_prd_upd_price_${item.id}` }],
        [{ text: "✏️ Edit Sizes", callback_data: `shop_prd_upd_sizes_${item.id}` }],
        [{ text: "📸 Edit Photo", callback_data: `shop_prd_upd_photo_${item.id}` }],
        [{ text: `${statusObj.icon} ${statusObj.text}`, callback_data: `shop_prd_tgl_${item.id}_${statusObj.val}` }],
        [{ text: "🗑️ Delete Product", callback_data: `shop_prd_del_${item.id}` }],
        [{ text: "↩️ Back to Products", callback_data: "cmd_shop_prd_menu" }]
    ];
    await sendMessage(chatId, `🛠️ *Edit Product: ${item.name}*\n\nPrice: ${item.price} EGP\nSizes: ${item.sizes}\nStatus: ${item.is_active ? 'Live 🟢' : 'Hidden 🔴'}\n\nWhat would you like to change?`, { inline_keyboard: buttons });
}

async function handleShopProductUpdateField(chatId, productId, fieldStr) {
    await setSession('shop_edit_item', { productId, field: fieldStr });
    let msg = "";
    if (fieldStr === 'name') msg = "✏️ Send the new *Name*:";
    if (fieldStr === 'price') msg = "✏️ Send the new *Price* (e.g. 300):";
    if (fieldStr === 'sizes') msg = "✏️ Send the new *Sizes* (e.g. S, M, L, XL):";
    if (fieldStr === 'photo') msg = "📸 Send the *new photo* directly in this chat:";
    await sendMessage(chatId, msg);
}

async function handleShopProductToggle(chatId, dataStr) {
    const parts = dataStr.split('_');
    const newState = parts.pop() === "true";
    const productId = parts.join('_');
    await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${productId}`, {
        method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ is_active: newState })
    });
    await sendMessage(chatId, `✅ Product visibility updated!`);
    await handleShopProductEditMenu(chatId, productId);
}

async function handleShopProductDelete(chatId, productId) {
    await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${productId}`, { method: 'DELETE', headers: dbHeaders });
    await sendMessage(chatId, `🗑️ ✅ Product permanently deleted.`);
    await handleShopProductMenu(chatId);
}

// ─── EDIT RUN ──────────────────────────────────────────────────────────────
async function handleEditList(chatId) {
    const runs = await dbGet('stride_runs');
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ No runs to edit."); return; }
    const buttons = runs.map((r, i) => {
        const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
        return [{ text: `✏️ ${i + 1}. ${dt}`, callback_data: `edit_pick_${r.id}` }];
    });
    buttons.push([{ text: "↩️ Back", callback_data: "cmd_menu" }]);
    await sendMessage(chatId, "✏️ *Which run do you want to edit?*", { inline_keyboard: buttons });
}

async function handleEditPickField(chatId, runId) {
    const runs = await dbGet('stride_runs', `id=eq.${runId}`);
    if (!runs || runs.length === 0) { await sendMessage(chatId, "❌ Run not found."); return; }
    const r = runs[0];
    const dt = r.date_label.includes('||') ? r.date_label.split('||')[0] : r.date_label;
    await setSession('edit_choosing_field', { runId, runLabel: dt });
    await sendMessage(chatId, `✏️ *Editing:* ${dt}\n\nWhat do you want to change?`, {
        inline_keyboard: [
            [{ text: "⏰ Date & Time", callback_data: "edit_field_datetime" }],
            [{ text: "📍 Location Name", callback_data: "edit_field_location" }],
            [{ text: "🗺️ Maps Link", callback_data: "edit_field_maps" }],
            [{ text: "↩️ Back", callback_data: "cmd_edit_list" }]
        ]
    });
}

async function handleEditDateTime(chatId) {
    const session = await getSession();
    const amHours = [4,5,6,7,8,9,10,11].map(h => ({ text: `${h} AM`, callback_data: `edit_hour_${String(h).padStart(2,'0')}` }));
    const pmHours = [1,2,3,4,5,6,7,8,9,10,11].map(h => ({ text: `${h} PM`, callback_data: `edit_hour_${String(h+12).padStart(2,'0')}` }));
    const special = [{ text: "12 PM", callback_data: "edit_hour_12" }, { text: "12 AM", callback_data: "edit_hour_00" }];
    const rows = [];
    for (let i = 0; i < amHours.length; i += 4) rows.push(amHours.slice(i, i+4));
    rows.push(special);
    for (let i = 0; i < pmHours.length; i += 4) rows.push(pmHours.slice(i, i+4));
    rows.push([{ text: "↩️ Back", callback_data: `edit_pick_${session.data.runId}` }]);
    await setSession('edit_picking_hour', session.data);
    await sendMessage(chatId, "⏰ *New time — pick the hour:*", { inline_keyboard: rows });
}

async function handleEditHour(chatId, hour) {
    const session = await getSession();
    await setSession('edit_picking_minutes', { ...session.data, hour });
    const h = parseInt(hour);
    const label = h === 0 ? '12 AM' : h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h-12} PM`;
    await sendMessage(chatId, `✅ Hour: *${label}*\n\n⏱️ *Minutes?*`, {
        inline_keyboard: [
            [{ text: ":00 (Sharp)", callback_data: "edit_min_00" }, { text: ":30", callback_data: "edit_min_30" }],
            [{ text: "↩️ Back", callback_data: "edit_field_datetime" }]
        ]
    });
}

async function handleEditMinutes(chatId, min) {
    const session = await getSession();
    await setSession('edit_picking_date', { ...session.data, min });
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const days = [];
    for (let i = 1; i <= 21; i++) {
        const d = new Date(); d.setDate(d.getDate() + i);
        days.push({ text: `${dayNames[d.getDay()]} ${monthNames[d.getMonth()]} ${d.getDate()}`, callback_data: `edit_date_${d.toISOString().split('T')[0]}` });
    }
    const rows = [];
    for (let i = 0; i < days.length; i += 2) rows.push(days.slice(i, i+2));
    rows.push([{ text: "↩️ Back", callback_data: "edit_field_datetime" }]);
    await sendMessage(chatId, `✅ Time: *${formatTime(`${session.data.hour}:${min}`)}*\n\n📅 *New date?*`, { inline_keyboard: rows });
}

async function handleEditDate(chatId, date) {
    const session = await getSession();
    const time = `${session.data.hour}:${session.data.min}`;
    const dateObj = new Date(`${date}T${time}`);
    const fd = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    const ft = formatTime(time);
    const newLabel = `${fd} - ${ft}||${dateObj.toISOString()}`;
    await dbPatch('stride_runs', 'id', session.data.runId, { date_label: newLabel });
    await clearSession();
    await sendMessage(chatId, `✅ *Run Updated!*\n\n📅 New date: *${fd}*\n⏰ New time: *${ft}*`);
    await sendMenu(chatId, "What else?");
}

async function handleEditLocation(chatId) {
    const session = await getSession();
    await setSession('edit_waiting_location', session.data);
    await sendMessage(chatId, `📍 *New location name for:*\n${session.data.runLabel}\n\nType the new location name:`);
}

async function handleEditMaps(chatId) {
    const session = await getSession();
    await setSession('edit_waiting_maps', session.data);
    await sendMessage(chatId, `🗺️ *New Maps link for:*\n${session.data.runLabel}\n\nPaste the new Google Maps link:`);
}

async function handleEditSaveLocation(chatId, text) {
    const session = await getSession();
    await dbPatch('stride_runs', 'id', session.data.runId, { location: text });
    await clearSession();
    await sendMessage(chatId, `✅ *Location updated to:*\n📍 ${text}`);
    await sendMenu(chatId, "What else?");
}

async function handleEditSaveMaps(chatId, text) {
    const session = await getSession();
    await dbPatch('stride_runs', 'id', session.data.runId, { location_link: text });
    await clearSession();
    await sendMessage(chatId, `✅ *Maps link updated!*\n🗺️ ${text}`);
    await sendMenu(chatId, "What else?");
}

// ─── GROWTH GRAPH ─────────────────────────────────────────────────────────────
async function handleGrowthGraph(chatId) {
    await sendMessage(chatId, "📈 Generating growth graph...");
    const users = await dbGet('stride_users');
    if (!users || users.length === 0) { await sendMessage(chatId, "❌ No members yet."); return; }
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
            datasets: [{ label: 'Total Members', data, borderColor: '#7c6ffa', backgroundColor: 'rgba(88,74,220,0.15)', fill: true, tension: 0.4, pointBackgroundColor: '#ff9e6d', pointRadius: 6, borderWidth: 3 }]
        },
        options: {
            plugins: { legend: { display: false }, title: { display: true, text: '🏃 Stride Rite — Community Growth', color: '#ffffff', font: { size: 16, weight: 'bold' } } },
            scales: { y: { beginAtZero: true, ticks: { color: '#a1a1aa', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.08)' } }, x: { ticks: { color: '#a1a1aa' }, grid: { display: false } } }
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
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs scheduled."); return; }
    const nextRun = runs[0]; // Chronologically closest upcoming run
    const regs = await dbGet('stride_registrations', `run_id=eq.${nextRun.id}`);
    const users = await dbGet('stride_users');
    let males = 0, females = 0, totalAge = 0;
    regs.forEach(r => {
        const u = users.find(uu => uu.id === r.user_id);
        if (u) { u.gender === 'Male' ? males++ : females++; totalAge += calculateAge(u.birthdate || '') || (parseInt(u.age) || 0); }
    });
    const avgAge = regs.length > 0 ? Math.round(totalAge / regs.length) : 0;
    const dt = nextRun.date_label.split('||')[0];
    await sendMessage(chatId, `📊 *Next Run Stats*\n📍 ${dt}\n\n👥 *Total RSVPs:* ${regs.length}\n🤸 *Gender:* ${males}M / ${females}F\n⏰ *Avg Age:* ${avgAge} years`);
}

// ─── LIST RUNS ────────────────────────────────────────────────────────────────
async function handleListRuns(chatId) {
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs scheduled."); return; }
    let msg = `📋 *Upcoming Scheduled Runs (${runs.length}):*\n\n`;
    runs.forEach((r, i) => {
        const dt = r.date_label.split('||')[0];
        const cancelled = r.is_cancelled ? ' 🚫 CANCELLED' : '';
        msg += `*${i + 1}.* ${dt}${cancelled}\n`;
    });
    await sendMessage(chatId, msg);
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
async function handleExport(chatId) {
    await sendMessage(chatId, "⏳ Generating export for the next upcoming run...");
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs found."); return; }
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
    const dt = nextRun.date_label.split('||')[0];
    await sendDocument(chatId, csv, `Stride_Rite_${dt.replace(/[^a-zA-Z0-9]/g, '_')}.csv`);
}

// ─── WHATSAPP BLAST ───────────────────────────────────────────────────────────
async function handleBlast(chatId) {
    const runs = await getSortedUpcomingRuns();
    if (runs.length === 0) { await sendMessage(chatId, "❌ No upcoming runs scheduled."); return; }
    const r = runs[0];
    const regs = await dbGet('stride_registrations', `run_id=eq.${r.id}`);
    const dt = r.date_label.split('||')[0];
    const registered = regs.length > 0 ? `✅ *${regs.length} runner${regs.length > 1 ? 's' : ''} already registered!*` : '';
    await sendMessage(chatId, `📲 *Copy & paste into WhatsApp for the upcoming run:*\n\n🏃‍♂️ Stride Rite Community Run 🏃‍♀️\n\n📅 ${dt}\n📍 ${r.location}\n🗺️ ${r.location_link}\n\n${registered}\n\nDon't miss it! Register 👇\n${SITE_URL}\n\n_Every pace is welcome. See you there!_ 💪`);
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
    await sendMessage(chatId, "🔍 *Runner Lookup*\n\nType the runner's name (or part of it):");
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
${history || '  No runs yet'}`);
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

👆 Copy emails above and paste into BCC in Gmail:
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
    await sendMessage(chatId, `🚫 *Cancel: ${dt}*\n\nPlease type the reason for cancellation:`);
}

async function handleCancelExecute(chatId, runId, reason) {
    await clearSession();
    await dbPatch('stride_runs', 'id', runId, { is_cancelled: true, cancel_reason: reason });
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

Suggested message:
_Hey Striders! Unfortunately the ${dt} run has been cancelled due to ${reason}. We apologize and look forward to seeing you at the next run! 💪_`);
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
    } catch (e) {
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
            else if (data === 'cmd_gallery_start') await handleGalleryStart(chatId);
            else if (data.startsWith('gallery_run_')) await handleGalleryRunPicked(chatId, data.replace('gallery_run_', ''));
            else if (data === 'cmd_gallery_delete') await handleGalleryDeleteList(chatId);
            else if (data.startsWith('gallery_del_yes_')) await handleGalleryDeleteExecute(chatId, data.replace('gallery_del_yes_', ''));
            else if (data.startsWith('gallery_del_')) await handleGalleryDeleteConfirm(chatId, data.replace('gallery_del_', ''));
            else if (data === 'cmd_shop_menu') await handleShopMenu(chatId);
            else if (data.startsWith('shop_toggle_')) await handleShopToggle(chatId, data.replace('shop_toggle_', ''));
            else if (data.startsWith('shop_appr_')) await handleShopOrderApprove(chatId, data.replace('shop_appr_', ''), cq.message.message_id, !!cq.message.photo);
            else if (data.startsWith('shop_rej_')) await handleShopOrderReject(chatId, data.replace('shop_rej_', ''), cq.message.message_id, !!cq.message.photo);
            else if (data === 'cmd_shop_export') await handleShopExportOrders(chatId);
            else if (data === 'cmd_shop_prd_menu') await handleShopProductMenu(chatId);
            else if (data === 'cmd_shop_prd_add') await handleShopProductAdd(chatId);
            else if (data.startsWith('shop_prd_edit_mn_')) await handleShopProductEditMenu(chatId, data.replace('shop_prd_edit_mn_', ''));
            else if (data.startsWith('shop_prd_upd_name_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_name_', ''), 'name');
            else if (data.startsWith('shop_prd_upd_price_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_price_', ''), 'price');
            else if (data.startsWith('shop_prd_upd_sizes_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_sizes_', ''), 'sizes');
            else if (data.startsWith('shop_prd_upd_photo_')) await handleShopProductUpdateField(chatId, data.replace('shop_prd_upd_photo_', ''), 'photo');
            else if (data.startsWith('shop_prd_tgl_')) await handleShopProductToggle(chatId, data.replace('shop_prd_tgl_', ''));
            else if (data.startsWith('shop_prd_del_')) await handleShopProductDelete(chatId, data.replace('shop_prd_del_', ''));
            else if (data === 'cmd_edit_list') await handleEditList(chatId);
            else if (data.startsWith('edit_pick_')) await handleEditPickField(chatId, data.replace('edit_pick_', ''));
            else if (data === 'edit_field_datetime') await handleEditDateTime(chatId);
            else if (data === 'edit_field_location') await handleEditLocation(chatId);
            else if (data === 'edit_field_maps') await handleEditMaps(chatId);
            else if (data.startsWith('edit_hour_')) await handleEditHour(chatId, data.replace('edit_hour_', ''));
            else if (data.startsWith('edit_min_')) await handleEditMinutes(chatId, data.replace('edit_min_', ''));
            else if (data.startsWith('edit_date_')) await handleEditDate(chatId, data.replace('edit_date_', ''));
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

        // Handle photo messages
        if (body.message && body.message.photo) {
            const chatId = body.message.chat.id.toString();
            if (chatId === ADMIN_CHAT_ID) {
                const session = await getSession();
                if (session.state === 'waiting_gallery_photo') {
                    await handleGalleryPhoto(chatId, body.message, session);
                } else if (session.state === 'shop_add_item' && session.data.step === 'photo') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message);
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload photo."); res.status(200).send('ok'); return; }
                    await dbInsert('shop_items', {
                        id: crypto.randomUUID(),
                        name: session.data.name,
                        price: parseInt(session.data.price),
                        sizes: session.data.sizes,
                        image_url: imgUrl,
                        is_active: true
                    });
                    await sendMessage(chatId, "✅ *Product successfully added to the VIP Shop!*");
                    await clearSession();
                    await handleShopProductMenu(chatId);
                } else if (session.state === 'shop_edit_item' && session.data.field === 'photo') {
                    const imgUrl = await uploadShopPhoto(chatId, body.message);
                    if (!imgUrl) { await sendMessage(chatId, "❌ Failed to upload photo."); res.status(200).send('ok'); return; }
                    await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${session.data.productId}`, {
                        method: 'PATCH', headers: dbHeaders, body: JSON.stringify({ image_url: imgUrl })
                    });
                    await sendMessage(chatId, "✅ *Photo successfully updated!*");
                    await clearSession();
                    await handleShopProductEditMenu(chatId, session.data.productId);
                } else {
                    await sendMessage(chatId, "📸 Got a photo! Choose an option from the menus to attach it somewhere.");
                }
            }
            res.status(200).send('ok'); return;
        }

        if (!body.message || !body.message.text) { res.status(200).send('ok'); return; }
        const chatId = body.message.chat.id.toString();
        if (chatId !== ADMIN_CHAT_ID) { res.status(200).send('ok'); return; }
        const text = body.message.text.trim();
        const cmd = text.split(' ')[0].toLowerCase();
        const session = await getSession();

        // Product addition flow
        if (session.state === 'shop_add_item') {
            const step = session.data.step;
            if (step === 'name') {
                await setSession('shop_add_item', { ...session.data, step: 'price', name: text });
                await sendMessage(chatId, "🛍️ *Add New Product (Step 2/4)*\n\nWhat is the price in EGP? (e.g., 300)");
                res.status(200).send('ok'); return;
            }
            if (step === 'price') {
                await setSession('shop_add_item', { ...session.data, step: 'sizes', price: text });
                await sendMessage(chatId, "🛍️ *Add New Product (Step 3/4)*\n\nWhat sizes are available? (e.g., 'S, M, L, XL, XXL')");
                res.status(200).send('ok'); return;
            }
            if (step === 'sizes') {
                await setSession('shop_add_item', { ...session.data, step: 'photo', sizes: text });
                await sendMessage(chatId, "🛍️ *Add New Product (Step 4/4)*\n\n📸 Now send the *product photo* from your gallery:");
                res.status(200).send('ok'); return;
            }
            if (step === 'photo') {
                await sendMessage(chatId, "📸 Please send an *IMAGE* from your phone's gallery, not text.");
                res.status(200).send('ok'); return;
            }
        }

        // Product edit flow
        if (session.state === 'shop_edit_item') {
            const { productId, field } = session.data;
            if (field === 'photo') {
                await sendMessage(chatId, "📸 Please send an *IMAGE* from your phone's gallery, not text.");
                res.status(200).send('ok'); return;
            }
            const updateData = {};
            if (field === 'price') updateData[field] = parseInt(text);
            else updateData[field] = text;
            await fetch(`${SUPABASE_URL}/rest/v1/shop_items?id=eq.${productId}`, {
                method: 'PATCH', headers: dbHeaders, body: JSON.stringify(updateData)
            });
            await sendMessage(chatId, `✅ *Product ${field} successfully updated!*`);
            await clearSession();
            await handleShopProductEditMenu(chatId, productId);
            res.status(200).send('ok'); return;
        }

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
        } else if (session.state === 'edit_waiting_location') {
            await handleEditSaveLocation(chatId, text);
        } else if (session.state === 'edit_waiting_maps') {
            await handleEditSaveMaps(chatId, text);
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
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
}
