const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const fetch = require("node-fetch");
const config = require("./config");

const app = express();
const PORT = process.env.PORT || 3000;

// 添加安全中间件
app.use(bodyParser.json());
app.use(express.static("public"));
app.use(require("helmet")()); // 添加安全头
app.use(require("cors")()); // 如果需要跨域

const db = new sqlite3.Database("./db.sqlite");

// --- DB Initialization ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        total_ref INTEGER DEFAULT 0,
        last_withdraw DATE DEFAULT NULL,
        withdraw_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS referrals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer TEXT,
        user TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referrer, user)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS withdraws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uid TEXT,
        amount INTEGER,
        upi TEXT,
        status TEXT DEFAULT 'pending',  -- pending/approved/rejected
        processed_at DATETIME,
        date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS daily_reset (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        last_reset DATE DEFAULT CURRENT_DATE
    )`);
});

// 每日重置提现次数
function resetDailyWithdraws() {
    const today = new Date().toISOString().split('T')[0];
    
    db.get("SELECT last_reset FROM daily_reset ORDER BY id DESC LIMIT 1", (err, row) => {
        if (!row || row.last_reset !== today) {
            db.run("UPDATE users SET withdraw_count = 0");
            db.run("INSERT INTO daily_reset (last_reset) VALUES (?)", [today]);
            console.log("Daily withdraw counts reset");
        }
    });
}

// 每小时检查一次重置
setInterval(resetDailyWithdraws, 3600000);

// Send message via Telegram
async function sendTelegram(chatId, text) {
    try {
        const response = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
                chat_id: chatId, 
                text,
                parse_mode: "HTML"
            })
        });
        
        if (!response.ok) {
            console.error("Telegram API error:", await response.text());
        }
    } catch (error) {
        console.error("Failed to send Telegram message:", error);
    }
}

// 验证UPI格式
function isValidUPI(upi) {
    const upiRegex = /^[a-zA-Z0-9.\-_]{2,49}@[a-zA-Z]{2,}$/;
    return upiRegex.test(upi);
}

// ==========================
// USER OPENS WEBSITE
// ==========================
app.post("/open", (req, res) => {
    const { uid, ref } = req.body;

    if (!uid) return res.json({ ok: false, error: "Missing UID" });

    db.get("SELECT * FROM users WHERE id=?", [uid], async (err, user) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ ok: false, error: "Server error" });
        }

        if (!user) {
            // New User → Give bonus
            db.run("INSERT INTO users (id, balance) VALUES (?, ?)", [uid, config.JOIN_BONUS], function(err) {
                if (err) {
                    console.error("Insert user error:", err);
                    return res.json({ ok: false, error: "Registration failed" });
                }

                // Handle Referral
                if (ref && ref !== uid) {
                    db.run("INSERT OR IGNORE INTO referrals (referrer, user) VALUES (?, ?)", [ref, uid], async function(err) {
                        if (err) console.error("Referral insert error:", err);

                        if (this.changes > 0) {
                            // Add referral bonus
                            db.run(`UPDATE users SET balance = balance + ?, total_ref = total_ref + 1 WHERE id=?`,
                                [config.REF_BONUS, ref], (err) => {
                                    if (err) console.error("Update referrer balance error:", err);
                                });

                            // Notify admin
                            await sendTelegram(config.ADMIN_ID, 
                                `👤 <b>New Referral!</b>\n\n` +
                                `Referrer: <code>${ref}</code>\n` +
                                `New User: <code>${uid}</code>`
                            );

                            // Notify referrer
                            await sendTelegram(ref, 
                                `🎉 <b>New referral added!</b>\n\n` +
                                `You earned ₹${config.REF_BONUS}\n` +
                                `New user: <code>${uid}</code>`
                            );
                        }
                    });
                }
            });
        }

        // Return user data
        db.get("SELECT * FROM users WHERE id=?", [uid], (err, u) => {
            if (err) {
                console.error("Database error:", err);
                return res.json({ ok: false, error: "Server error" });
            }
            res.json({ 
                ok: true, 
                user: u,
                limits: {
                    min_withdraw: config.MIN_WITHDRAW,
                    max_withdraw: config.MAX_WITHDRAW,
                    daily_limit: config.DAILY_WITHDRAW_LIMIT
                }
            });
        });
    });
});

// ==========================
// WITHDRAW REQUEST
// ==========================
app.post("/withdraw", (req, res) => {
    const { uid, upi } = req.body;

    if (!uid || !upi) {
        return res.json({ ok: false, error: "Missing required fields" });
    }

    if (!isValidUPI(upi)) {
        return res.json({ ok: false, error: "Invalid UPI ID format" });
    }

    db.get("SELECT * FROM users WHERE id=?", [uid], async (err, user) => {
        if (err) {
            console.error("Database error:", err);
            return res.json({ ok: false, error: "Server error" });
        }

        if (!user) return res.json({ ok: false, error: "User not found" });

        // Daily limit check
        const today = new Date().toISOString().split('T')[0];
        if (user.last_withdraw === today && user.withdraw_count >= config.DAILY_WITHDRAW_LIMIT) {
            return res.json({ 
                ok: false, 
                error: `Daily withdraw limit reached (${config.DAILY_WITHDRAW_LIMIT} per day)` 
            });
        }

        // Balance check
        if (user.balance < config.MIN_WITHDRAW) {
            return res.json({ 
                ok: false, 
                error: `Minimum withdraw amount is ₹${config.MIN_WITHDRAW}` 
            });
        }

        // Reset daily counter if it's a new day
        const withdrawCount = user.last_withdraw === today ? user.withdraw_count + 1 : 1;

        db.serialize(() => {
            // Deduct balance
            db.run(`UPDATE users SET 
                balance = balance - ?, 
                withdraw_count = ?,
                last_withdraw = ?
                WHERE id=?`,
                [config.MIN_WITHDRAW, withdrawCount, today, uid]);

            // Save withdraw
            db.run("INSERT INTO withdraws (uid, amount, upi) VALUES (?, ?, ?)",
                [uid, config.MIN_WITHDRAW, upi], async function(err) {
                    if (err) {
                        console.error("Withdraw save error:", err);
                        return res.json({ ok: false, error: "Withdraw failed" });
                    }

                    // Notify admin
                    await sendTelegram(
                        config.ADMIN_ID,
                        `💸 <b>New Withdraw Request</b>\n\n` +
                        `ID: <code>${this.lastID}</code>\n` +
                        `User: <code>${uid}</code>\n` +
                        `Amount: ₹${config.MIN_WITHDRAW}\n` +
                        `UPI: <code>${upi}</code>\n` +
                        `Time: ${new Date().toLocaleString()}`
                    );

                    // Notify user
                    await sendTelegram(
                        uid,
                        `✅ <b>Withdraw Request Submitted</b>\n\n` +
                        `Amount: ₹${config.MIN_WITHDRAW}\n` +
                        `UPI: ${upi}\n` +
                        `Status: Pending\n\n` +
                        `Request ID: ${this.lastID}\n` +
                        `Date: ${new Date().toLocaleString()}`
                    );

                    res.json({ 
                        ok: true, 
                        message: "Withdraw submitted successfully",
                        request_id: this.lastID,
                        amount: config.MIN_WITHDRAW
                    });
                });
        });
    });
});

// ==========================
// ADDITIONAL ENDPOINTS
// ==========================

// 获取用户余额
app.get("/balance/:uid", (req, res) => {
    const { uid } = req.params;
    
    db.get("SELECT balance FROM users WHERE id=?", [uid], (err, row) => {
        if (err || !row) {
            return res.json({ ok: false, error: "User not found" });
        }
        res.json({ ok: true, balance: row.balance });
    });
});

// 获取用户提现历史
app.get("/withdraw-history/:uid", (req, res) => {
    const { uid } = req.params;
    
    db.all("SELECT * FROM withdraws WHERE uid=? ORDER BY date DESC LIMIT 20", [uid], (err, rows) => {
        if (err) {
            return res.json({ ok: false, error: "Database error" });
        }
        res.json({ ok: true, withdrawals: rows });
    });
});

// 获取推荐列表
app.get("/referrals/:uid", (req, res) => {
    const { uid } = req.params;
    
    db.all("SELECT * FROM referrals WHERE referrer=? ORDER BY created_at DESC", [uid], (err, rows) => {
        if (err) {
            return res.json({ ok: false, error: "Database error" });
        }
        res.json({ ok: true, referrals: rows, count: rows.length });
    });
});

// 管理员端点 (需要验证)
app.post("/admin/update-withdraw", (req, res) => {
    const { request_id, status, admin_secret } = req.body;
    
    if (admin_secret !== process.env.ADMIN_SECRET) {
        return res.json({ ok: false, error: "Unauthorized" });
    }
    
    db.run("UPDATE withdraws SET status=?, processed_at=CURRENT_TIMESTAMP WHERE id=?",
        [status, request_id], function(err) {
            if (err) {
                return res.json({ ok: false, error: "Update failed" });
            }
            
            // 通知用户状态变更
            db.get("SELECT uid FROM withdraws WHERE id=?", [request_id], (err, row) => {
                if (row) {
                    const statusMsg = status === 'approved' ? '✅ Approved' : '❌ Rejected';
                    sendTelegram(row.uid, `Your withdraw request #${request_id} has been ${status}`);
                }
            });
            
            res.json({ ok: true, message: `Withdraw ${status}` });
        });
});

// 健康检查
app.get("/health", (req, res) => {
    res.json({ 
        ok: true, 
        status: "running", 
        timestamp: new Date().toISOString() 
    });
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ ok: false, error: "Internal server error" });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    resetDailyWithdraws(); // 启动时重置
});
