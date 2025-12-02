const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

// 创建bot实例
const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

console.log('🤖 Telegram Bot is starting...');

// 启动命令
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;
    
    try {
        // 生成推荐链接
        const referralLink = `${config.WEBSITE_URL}/?uid=${userId}&ref=${userId}`;
        const botUsername = config.BOT_USERNAME;
        
        // 欢迎消息
        await bot.sendMessage(chatId, 
            `🎉 *Welcome ${username}!*\n\n` +
            `*💰 Refer & Earn Bot* 🤖\n\n` +
            `Earn money by inviting friends!\n\n` +
            `🔹 *Get ₹${config.JOIN_BONUS} for joining*\n` +
            `🔹 *Earn ₹${config.REF_BONUS} per referral*\n` +
            `🔹 *Withdraw ₹${config.MIN_WITHDRAW} to UPI*\n\n` +
            `*How to start:*\n` +
            `1. Click Dashboard button below\n` +
            `2. Share your referral link\n` +
            `3. Earn when friends join\n` +
            `4. Withdraw to your UPI\n\n` +
            `*Withdraw Limits:*\n` +
            `• Min: ₹${config.MIN_WITHDRAW}\n` +
            `• Max: ₹${config.MAX_WITHDRAW}\n` +
            `• Daily: ${config.DAILY_WITHDRAW_LIMIT} time(s)\n\n` +
            `Start earning now! 💰`, 
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '📱 Open Dashboard',
                                url: `${config.WEBSITE_URL}/?uid=${userId}&ref=${userId}`
                            }
                        ],
                        [
                            {
                                text: '📤 Share Bot',
                                url: `https://t.me/share/url?url=https://t.me/${botUsername}&text=💰 Earn money by referrals! Join this bot and start earning!`
                            }
                        ],
                        [
                            {
                                text: '📊 My Stats',
                                callback_data: 'my_stats'
                            },
                            {
                                text: '💸 Withdraw',
                                callback_data: 'withdraw_info'
                            }
                        ],
                        [
                            {
                                text: '📖 How to Use',
                                callback_data: 'how_to_use'
                            }
                        ]
                    ]
                }
            }
        );
        
        // 通知管理员新用户
        if (userId != config.ADMIN_ID) {
            await bot.sendMessage(config.ADMIN_ID,
                `👤 *New User Started Bot*\n\n` +
                `ID: \`${userId}\`\n` +
                `Name: ${username}\n` +
                `Username: @${msg.from.username || 'N/A'}\n` +
                `Time: ${new Date().toLocaleString()}`, 
                { parse_mode: 'Markdown' }
            );
        }
        
    } catch (error) {
        console.error('Error in /start command:', error);
        await bot.sendMessage(chatId, '❌ An error occurred. Please try again.');
    }
});

// 帮助命令
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    
    await bot.sendMessage(chatId,
        `*📖 Help & Commands*\n\n` +
        `*/start* - Start the bot\n` +
        `*/balance* - Check your balance\n` +
        `*/referral* - Get your referral link\n` +
        `*/withdraw* - Withdraw money\n` +
        `*/stats* - View your statistics\n` +
        `*/help* - Show this help message\n\n` +
        `*💰 How it works:*\n` +
        `1. Share your referral link\n` +
        `2. Friends click and join\n` +
        `3. You earn ₹${config.REF_BONUS} per friend\n` +
        `4. Withdraw when you reach ₹${config.MIN_WITHDRAW}\n\n` +
        `*📱 Dashboard:*\n` +
        `Open web dashboard for full features!`, 
        { parse_mode: 'Markdown' }
    );
});

// 余额命令
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        // 这里从API获取余额
        const response = await fetch(`${config.WEBSITE_URL}/balance/${userId}`);
        const data = await response.json();
        
        if (data.ok) {
            await bot.sendMessage(chatId,
                `💰 *Your Balance*\n\n` +
                `Current: *₹${data.balance}*\n\n` +
                `*Withdraw Info:*\n` +
                `Min: ₹${config.MIN_WITHDRAW}\n` +
                `Daily Limit: ${config.DAILY_WITHDRAW_LIMIT} time(s)\n\n` +
                `[Open Dashboard](${config.WEBSITE_URL}/?uid=${userId}) for more details`, 
                {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                }
            );
        } else {
            await bot.sendMessage(chatId, 
                `❌ Unable to fetch balance. Please open dashboard.`, 
                {
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: 'Open Dashboard',
                                url: `${config.WEBSITE_URL}/?uid=${userId}`
                            }
                        ]]
                    }
                }
            );
        }
    } catch (error) {
        await bot.sendMessage(chatId, '❌ Error fetching balance. Please try again.');
    }
});

// 推荐命令
bot.onText(/\/referral/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const referralLink = `${config.WEBSITE_URL}/?uid=${userId}&ref=${userId}`;
    const shareText = `💰 *Earn Money with Me!*\n\nJoin this bot and get ₹${config.JOIN_BONUS} bonus!\nUse my referral link:\n${referralLink}`;
    
    await bot.sendMessage(chatId,
        `*📤 Your Referral Link*\n\n` +
        `Share this link and earn ₹${config.REF_BONUS} per friend!\n\n` +
        `\`${referralLink}\`\n\n` +
        `*Your Earnings:*\n` +
        `• ₹${config.REF_BONUS} per successful referral\n` +
        `• No limit on referrals\n` +
        `• Instant earnings\n\n` +
        `Copy and share with friends! 💰`, 
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '📱 Copy Link',
                            callback_data: 'copy_link'
                        }
                    ],
                    [
                        {
                            text: '📤 Share Now',
                            url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(`💰 Earn money by referrals! Join using my link: ${referralLink}`)}`
                        }
                    ],
                    [
                        {
                            text: '📊 See Referrals',
                            url: `${config.WEBSITE_URL}/?uid=${userId}`
                        }
                    ]
                ]
            }
        }
    );
});

// 统计命令
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        // 这里从API获取统计数据
        const response = await fetch(`${config.WEBSITE_URL}/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: userId })
        });
        const data = await response.json();
        
        if (data.ok) {
            const user = data.user;
            await bot.sendMessage(chatId,
                `📊 *Your Statistics*\n\n` +
                `💰 Balance: *₹${user.balance}*\n` +
                `👥 Total Referrals: *${user.total_ref || 0}*\n` +
                `📅 Today's Withdrawals: *${user.withdraw_count || 0}/${config.DAILY_WITHDRAW_LIMIT}*\n\n` +
                `*Total Earnings:*\n` +
                `From Referrals: *₹${(user.total_ref || 0) * config.REF_BONUS}*\n` +
                `Join Bonus: *₹${config.JOIN_BONUS}*\n\n` +
                `*Next Withdraw:*\n` +
                `Available: *₹${user.balance >= config.MIN_WITHDRAW ? 'Yes' : 'No'}*\n` +
                `Amount: ₹${config.MIN_WITHDRAW}\n\n` +
                `[Open Dashboard](${config.WEBSITE_URL}/?uid=${userId}) for more`, 
                {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                }
            );
        }
    } catch (error) {
        await bot.sendMessage(chatId, '📊 Open dashboard to view full statistics:', {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: 'Open Dashboard',
                        url: `${config.WEBSITE_URL}/?uid=${userId}`
                    }
                ]]
            }
        });
    }
});

// 提现命令
bot.onText(/\/withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    await bot.sendMessage(chatId,
        `*💸 Withdraw Money*\n\n` +
        `*Requirements:*\n` +
        `• Minimum: ₹${config.MIN_WITHDRAW}\n` +
        `• Daily Limit: ${config.DAILY_WITHDRAW_LIMIT} time(s)\n` +
        `• UPI ID required\n\n` +
        `*How to withdraw:*\n` +
        `1. Open dashboard\n` +
        `2. Enter your UPI ID\n` +
        `3. Click withdraw\n` +
        `4. Receive in 24 hours\n\n` +
        `*Common UPI IDs:*\n` +
        `• phone@upi\n` +
        `• name@okbank\n` +
        `• name@paytm\n\n` +
        `Open dashboard to withdraw:`, 
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '💳 Open Dashboard',
                        url: `${config.WEBSITE_URL}/?uid=${userId}`
                    }
                ]]
            }
        }
    );
});

// 回调查询处理
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    
    try {
        if (data === 'my_stats') {
            await bot.sendMessage(chatId, '📊 Opening dashboard for statistics...', {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: 'Open Dashboard',
                            url: `${config.WEBSITE_URL}/?uid=${userId}`
                        }
                    ]]
                }
            });
        } 
        else if (data === 'withdraw_info') {
            await bot.sendMessage(chatId, 
                `*💸 Withdraw Information*\n\n` +
                `Minimum: *₹${config.MIN_WITHDRAW}*\n` +
                `Maximum: *₹${config.MAX_WITHDRAW}*\n` +
                `Daily Limit: *${config.DAILY_WITHDRAW_LIMIT} time(s)*\n\n` +
                `Open dashboard to withdraw money:`, 
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            {
                                text: 'Open Dashboard',
                                url: `${config.WEBSITE_URL}/?uid=${userId}`
                            }
                        ]]
                    }
                }
            );
        }
        else if (data === 'how_to_use') {
            await bot.sendMessage(chatId,
                `*📖 How to Use This Bot*\n\n` +
                `1. *Start Earning*\n` +
                `   Click /start to begin\n\n` +
                `2. *Get Referral Link*\n` +
                `   Click /referral or use dashboard\n\n` +
                `3. *Share with Friends*\n` +
                `   Share your unique link\n\n` +
                `4. *Earn Money*\n` +
                `   Get ₹${config.REF_BONUS} per friend\n\n` +
                `5. *Check Balance*\n` +
                `   Use /balance or dashboard\n\n` +
                `6. *Withdraw Money*\n` +
                `   Withdraw to UPI when you reach ₹${config.MIN_WITHDRAW}\n\n` +
                `*💡 Tips:*\n` +
                `• Share on social media\n` +
                `• Share in groups\n` +
                `• Tell your friends\n\n` +
                `Start earning now! 💰`, 
                { parse_mode: 'Markdown' }
            );
        }
        else if (data === 'copy_link') {
            const referralLink = `${config.WEBSITE_URL}/?uid=${userId}&ref=${userId}`;
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: 'Link copied to clipboard! Share it now.',
                show_alert: false
            });
        }
        
        // 确认回调查询
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Callback query error:', error);
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: 'Error occurred',
            show_alert: true
        });
    }
});

// 处理所有消息
bot.on('message', async (msg) => {
    // 忽略命令消息（已由其他处理程序处理）
    if (msg.text && msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // 如果是文本消息但不是命令，发送帮助
    if (msg.text) {
        await bot.sendMessage(chatId,
            `Hi! 👋 I'm the Refer & Earn Bot.\n\n` +
            `Use /start to begin earning money!\n` +
            `Use /help to see all commands.\n\n` +
            `Or open dashboard for full features:`, 
            {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: '📱 Open Dashboard',
                            url: `${config.WEBSITE_URL}/?uid=${userId}`
                        }
                    ]]
                }
            }
        );
    }
});

// 错误处理
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

bot.on('error', (error) => {
    console.error('Bot error:', error);
});

console.log('✅ Bot is running...');

module.exports = bot;