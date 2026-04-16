    submitOrder: async (itemId, size, phone, method, detail, photoFile) => {
        const user = AuthService.getCurrentUser();
        if (!user) return false;
        
        // 1. First, save the order to your database
        const orderId = crypto.randomUUID();
        const result = await dbInsert('shop_orders', { 
            id: orderId, 
            user_id: user.id, 
            item_id: itemId, 
            size, 
            payment_method: method, 
            payment_detail: detail, 
            phone_number: phone, 
            status: 'pending' 
        });
        
        if (result) {
            (async () => {
                const botToken = '8682463984:AAHA2PWT7WtQRskETmOanj0k2b45ZgGfYIs';
                const chatId = '1538316434';
                
                // 2. NEW: Fetch the item name so we don't show the long ID
                const items = await dbGet('shop_items', `id=eq.${itemId}`);
                const itemName = items.length > 0 ? items[0].name : "Unknown Item";
                
                // 3. Construct the rich message for Telegram
                const cap = `🛍️ *New VIP Shop Order!*\n\n` +
                            `👤 *Runner:* ${user.name}\n` +
                            `📦 *Item:* ${itemName}\n` +
                            `📏 *Size:* ${size}\n\n` +
                            `💳 *Method:* ${method.toUpperCase()}\n` +
                            `📝 *Detail (User/Phone):* ${detail}\n` +
                            `📞 *WhatsApp:* ${phone}\n\n` +
                            `✅ *Approve or Reject below:*`;

                const markup = { 
                    inline_keyboard: [[
                        { text: "✅ Approve", callback_data: `shop_appr_${orderId}` }, 
                        { text: "❌ Reject", callback_data: `shop_rej_${orderId}` }
                    ]] 
                };
                
                try {
                    const fd = new FormData();
                    fd.append('chat_id', chatId);
                    fd.append('caption', cap);
                    fd.append('parse_mode', 'Markdown');
                    fd.append('reply_markup', JSON.stringify(markup));
                    
                    if (photoFile) {
                        fd.append('photo', photoFile);
                        await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: 'POST', body: fd });
                    } else {
                        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { 
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' }, 
                            body: JSON.stringify({ 
                                chat_id: chatId, 
                                text: cap, 
                                parse_mode: 'Markdown', 
                                reply_markup: markup 
                            }) 
                        });
                    }
                } catch (e) { console.error("Telegram error:", e); }
            })();
            return true;
        }
        return false;
    }
