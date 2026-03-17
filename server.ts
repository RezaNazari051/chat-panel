import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import fs from 'fs';
import rateLimit from 'express-rate-limit';

declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-prod';
const PORT = 3000;

// Initialize SQLite Database
const db = new Database('chat.db');

// Setup Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'temporary', -- 'admin', 'registered', 'temporary'
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    is_approved INTEGER DEFAULT 0,
    is_banned INTEGER DEFAULT 0,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS invite_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE,
    expires_at DATETIME,
    max_uses INTEGER,
    current_uses INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER,
    sender_id INTEGER,
    content TEXT,
    file_url TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(sender_id) REFERENCES users(id)
  );
`);

try {
  db.exec("ALTER TABLE messages ADD COLUMN file_url TEXT;");
} catch (e) {
  // Column might already exist
}

try {
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0;");
} catch (e) {
  // Column might already exist
}

try {
  db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0;");
} catch (e) {
  // Column might already exist
}

try {
  db.exec("ALTER TABLE users ADD COLUMN invite_link_id INTEGER;");
} catch (e) {
  // Column might already exist
}

try {
  db.exec("ALTER TABLE messages ADD COLUMN is_spoiler INTEGER DEFAULT 0;");
} catch (e) {
  // Column might already exist
}

try {
  db.exec("ALTER TABLE messages ADD COLUMN expires_at DATETIME;");
} catch (e) {
  // Column might already exist
}

// Setup uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
})

const upload = multer({ storage: storage })

// Create default admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password_hash, role, first_name, last_name, is_approved) VALUES (?, ?, ?, ?, ?, ?)').run('admin', hash, 'admin', 'Admin', 'User', 1);
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    }
  });

  app.use(cors());
  app.use(express.json());

  // Error handling for invalid JSON
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'فرمت داده‌های ارسالی نامعتبر است' });
    }
    next();
  });

  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  app.get('/api/ping', (req, res) => {
    res.json({ message: 'pong', timestamp: new Date().toISOString() });
  });

  // Rate limiters
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 login requests per windowMs
    message: { error: 'تعداد درخواست‌های ورود بیش از حد مجاز است. لطفا ۱۵ دقیقه دیگر تلاش کنید.' }
  });

  const passwordChangeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // limit each IP to 3 password change requests per windowMs
    message: { error: 'تعداد درخواست‌های تغییر رمز عبور بیش از حد مجاز است. لطفا بعدا تلاش کنید.' }
  });

  // API Routes
  
  // Auth Middleware
  const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, decodedUser: any) => {
      if (err) return res.sendStatus(403);
      
      // Verify token_version and expiration against database
      const dbUser = db.prepare('SELECT token_version, expires_at, role, is_banned, invite_link_id FROM users WHERE id = ?').get(decodedUser.id) as any;
      if (!dbUser || dbUser.token_version !== decodedUser.token_version) {
        return res.status(401).json({ error: 'نشست شما منقضی شده است. لطفا دوباره وارد شوید.' });
      }

      if (dbUser.is_banned) {
        return res.status(401).json({ error: 'حساب کاربری شما مسدود شده است.' });
      }

      if (dbUser.role === 'temporary') {
        // Check user-specific expiration
        if (dbUser.expires_at && new Date(dbUser.expires_at) < new Date()) {
          return res.status(401).json({ error: 'زمان دسترسی شما به پایان رسیده است.' });
        }

        // Check associated invite link validity
        if (dbUser.invite_link_id) {
          const invite = db.prepare('SELECT expires_at FROM invite_links WHERE id = ?').get(dbUser.invite_link_id) as any;
          if (!invite) {
            return res.status(401).json({ error: 'لینک دعوت مربوطه حذف شده است.' });
          }
          if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
            return res.status(401).json({ error: 'لینک دعوت مربوطه منقضی شده است.' });
          }
        }
      }
      
      req.user = decodedUser;
      next();
    });
  };

  const isAdmin = (req: any, res: any, next: any) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    next();
  };

  // Login
  app.post('/api/auth/login', loginLimiter, (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است' });
    }

    if (user.is_banned) {
      return res.status(403).json({ error: 'حساب کاربری شما مسدود شده است' });
    }

    if (user.role === 'temporary' && !user.is_approved) {
      return res.status(403).json({ error: 'حساب شما هنوز تایید نشده است' });
    }

    if (user.role === 'temporary' && user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'زمان دسترسی شما به پایان رسیده است' });
    }

    const token = jwt.sign({ id: user.id, role: user.role, username: user.username, token_version: user.token_version }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, first_name: user.first_name, last_name: user.last_name, must_change_password: user.must_change_password } });
  });

  // Temporary User Registration via Invite Link
  app.post('/api/auth/register-temp', (req, res) => {
    try {
      const { token, first_name, last_name, phone } = req.body;
      console.log('Registering temp user:', { token, first_name, last_name, phone });
      
      // Check token
      const invite = db.prepare('SELECT * FROM invite_links WHERE token = ?').get(token) as any;
      if (!invite) return res.status(400).json({ error: 'لینک دعوت نامعتبر است' });
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'لینک دعوت منقضی شده است' });
      if (invite.max_uses > 0 && invite.current_uses >= invite.max_uses) return res.status(400).json({ error: 'ظرفیت لینک دعوت تکمیل شده است' });

      // Check for existing phone number
      const existingUser = db.prepare("SELECT id FROM users WHERE phone = ? AND role = 'temporary'").get(phone) as any;
      const isDuplicate = !!existingUser;

      // Create temp user
      const username = 'temp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const result = db.prepare('INSERT INTO users (username, role, first_name, last_name, phone, invite_link_id) VALUES (?, ?, ?, ?, ?, ?)').run(username, 'temporary', first_name, last_name, phone, invite.id);
      
      // Increment invite uses
      db.prepare('UPDATE invite_links SET current_uses = current_uses + 1 WHERE id = ?').run(invite.id);

      // Create conversation
      db.prepare('INSERT INTO conversations (user_id) VALUES (?)').run(result.lastInsertRowid);

      // Notify admin via socket
      io.to('admin_room').emit('new_user_request', { 
        id: Number(result.lastInsertRowid), 
        first_name, 
        last_name, 
        phone,
        is_duplicate: isDuplicate,
        existing_user_id: existingUser?.id
      });

      res.json({ message: 'درخواست شما ثبت شد. منتظر تایید مدیر باشید.', username });
    } catch (error: any) {
      console.error('Error in register-temp:', error);
      res.status(500).json({ error: 'خطای سرور در ثبت درخواست: ' + error.message });
    }
  });

  // Check Temp User Status
  app.get('/api/auth/status/:username', (req, res) => {
    const user = db.prepare('SELECT id, role, is_approved, is_banned, expires_at, token_version, must_change_password FROM users WHERE username = ?').get(req.params.username) as any;
    if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
    
    if (user.is_approved) {
      // Check if expired
      if (user.expires_at && new Date(user.expires_at) < new Date()) {
        return res.json({ status: 'expired' });
      }
      // Generate token if approved
      const token = jwt.sign({ id: user.id, role: user.role, username: req.params.username, token_version: user.token_version }, JWT_SECRET, { expiresIn: '24h' });
      res.json({ status: 'approved', token, user });
    } else if (user.is_banned) {
      res.json({ status: 'banned' });
    } else {
      res.json({ status: 'pending' });
    }
  });

  // Change Password
  app.post('/api/auth/change-password', authenticateToken, passwordChangeLimiter, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    
    // Validate new password strength
    const passwordRegex = /^(?=.*\d)(?=.*[A-Z@$!%*?&]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر، شامل یک عدد، و یک حرف بزرگ یا کاراکتر خاص باشد' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id) as any;
    
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'رمز عبور فعلی اشتباه است' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    const newTokenVersion = user.token_version + 1;
    
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = ? WHERE id = ?')
      .run(hash, newTokenVersion, req.user.id);
      
    res.json({ success: true, message: 'رمز عبور با موفقیت تغییر کرد' });
  });

  // Admin: Reset User Password
  app.post('/api/admin/users/:id/reset-password', authenticateToken, isAdmin, (req, res) => {
    const { newPassword } = req.body;
    
    // Validate new password strength
    const passwordRegex = /^(?=.*\d)(?=.*[A-Z@$!%*?&]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ error: 'رمز عبور باید حداقل ۸ کاراکتر، شامل یک عدد، و یک حرف بزرگ یا کاراکتر خاص باشد' });
    }

    const hash = bcrypt.hashSync(newPassword, 10);
    
    // Invalidate user's current tokens by incrementing token_version
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?')
      .run(hash, req.params.id);
      
    // Disconnect user if connected
    io.to(`user_${req.params.id}`).emit('user_banned'); // Or a specific 'force_logout' event
      
    res.json({ success: true, message: 'رمز عبور کاربر ریست شد' });
  });

  // Admin: Get all conversations
  app.get('/api/admin/conversations', authenticateToken, isAdmin, (req, res) => {
    const conversations = db.prepare(`
      SELECT c.id, c.user_id, u.first_name, u.last_name, u.phone, u.role, u.is_approved, u.is_banned, u.expires_at,
      (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND is_read = 0 AND sender_id != ?) as unread_count,
      (SELECT COUNT(*) FROM users WHERE phone = u.phone AND id != u.id AND role = 'temporary') as duplicate_count,
      (SELECT first_name || ' ' || last_name FROM users WHERE phone = u.phone AND id != u.id AND role = 'temporary' ORDER BY created_at DESC LIMIT 1) as previous_name
      FROM conversations c
      JOIN users u ON c.user_id = u.id
      ORDER BY last_message_time DESC NULLS LAST, c.created_at DESC
    `).all(req.user.id);
    res.json(conversations);
  });

  // Admin: Update Username
  app.patch('/api/admin/users/:id/username', authenticateToken, isAdmin, (req, res) => {
    const { username } = req.body;
    try {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(username, req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      if (e.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ error: 'نام کاربری از قبل وجود دارد' });
      } else {
        res.status(500).json({ error: 'خطای سرور' });
      }
    }
  });

  // Admin: Approve user
  app.post('/api/admin/users/:id/approve', authenticateToken, isAdmin, (req, res) => {
    const { minutes, clear_history, load_history } = req.body; // Expiration minutes
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + (minutes || 180));
    
    db.prepare('UPDATE users SET is_approved = 1, expires_at = ? WHERE id = ?').run(expiresAt.toISOString(), req.params.id);
    
    // Handle duplicates and history
    const currentUser = db.prepare('SELECT phone FROM users WHERE id = ?').get(req.params.id) as any;
    if (currentUser && currentUser.phone) {
      // Find all previous temporary users with the same phone
      const previousUsers = db.prepare("SELECT id FROM users WHERE phone = ? AND id != ? AND role = 'temporary'").all(currentUser.phone, req.params.id) as any[];
      
      for (const prevUser of previousUsers) {
        const oldConv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(prevUser.id) as any;
        const newConv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(req.params.id) as any;

        if (oldConv && newConv) {
          if (load_history) {
            // Move messages from old conversation to new one
            db.prepare(`
              UPDATE messages 
              SET conversation_id = ?, 
                  sender_id = CASE WHEN sender_id = ? THEN ? ELSE sender_id END 
              WHERE conversation_id = ?
            `).run(newConv.id, prevUser.id, req.params.id, oldConv.id);
          } else {
            // Delete messages from old conversation if not loading history
            db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(oldConv.id);
          }
          
          // Delete the old conversation and user record to prevent duplicates in the admin list
          db.prepare('DELETE FROM conversations WHERE id = ?').run(oldConv.id);
          db.prepare('DELETE FROM users WHERE id = ?').run(prevUser.id);
        }
      }
    }

    // If clear_history was requested for the NEW conversation (though usually it's empty)
    if (clear_history && !load_history) {
      const conv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(req.params.id) as any;
      if (conv) {
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
        io.to(`conv_${conv.id}`).emit('chat_cleared');
      }
    }

    // Notify user if connected
    io.to(`user_${req.params.id}`).emit('user_approved', { expires_at: expiresAt });
    
    res.json({ success: true });
  });

  // Admin: Ban/Block user
  app.post('/api/admin/users/:id/ban', authenticateToken, isAdmin, (req, res) => {
    const { is_banned } = req.body;
    db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').run(is_banned ? 1 : 0, req.params.id);
    
    if (is_banned) {
      io.to(`user_${req.params.id}`).emit('user_banned');
    }
    
    res.json({ success: true });
  });

  // Admin: Create Registered User
  app.post('/api/admin/users', authenticateToken, isAdmin, (req, res) => {
    const { username, password, first_name, last_name, phone } = req.body;
    
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = db.prepare('INSERT INTO users (username, password_hash, role, first_name, last_name, phone, is_approved) VALUES (?, ?, ?, ?, ?, ?, 1)').run(username, hash, 'registered', first_name, last_name, phone);
      
      // Create conversation
      db.prepare('INSERT INTO conversations (user_id) VALUES (?)').run(result.lastInsertRowid);
      
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      if (e.message.includes('UNIQUE constraint failed')) {
        res.status(400).json({ error: 'نام کاربری از قبل وجود دارد' });
      } else {
        res.status(500).json({ error: 'خطای سرور' });
      }
    }
  });

  // Admin: Delete conversation and user
  app.delete('/api/admin/conversations/:id', authenticateToken, isAdmin, (req, res) => {
    const conversationId = req.params.id;
    const conv = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(conversationId) as any;
    
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    try {
      // Use a transaction for safety
      const deleteTransaction = db.transaction(() => {
        // Delete messages
        db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
        // Delete conversation
        db.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
        // Delete user
        db.prepare('DELETE FROM users WHERE id = ?').run(conv.user_id);
      });

      deleteTransaction();
      
      io.to(`conv_${conversationId}`).emit('force_logout');
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      res.status(500).json({ error: 'خطا در حذف گفتگو' });
    }
  });

  // Admin: Delete single message
  app.delete('/api/admin/messages/:id', authenticateToken, isAdmin, (req, res) => {
    const messageId = req.params.id;
    const msg = db.prepare('SELECT conversation_id FROM messages WHERE id = ?').get(messageId) as any;
    if (msg) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
      io.to(`conv_${msg.conversation_id}`).emit('message_deleted', { messageId: Number(messageId) });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Message not found' });
    }
  });

  // Admin: Clear all messages in a conversation
  app.delete('/api/admin/conversations/:id/messages', authenticateToken, isAdmin, (req, res) => {
    const conversationId = req.params.id;
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    io.to(`conv_${conversationId}`).emit('chat_cleared');
    res.json({ success: true });
  });

  // Admin: Generate Invite Link
  app.post('/api/admin/invites', authenticateToken, isAdmin, (req, res) => {
    const { minutes, max_uses } = req.body;
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    
    let expiresAt = null;
    if (minutes) {
      expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + Number(minutes));
    }

    db.prepare('INSERT INTO invite_links (token, expires_at, max_uses, created_by) VALUES (?, ?, ?, ?)').run(
      token, expiresAt ? expiresAt.toISOString() : null, max_uses || 0, req.user.id
    );
    
    res.json({ token, url: `${process.env.APP_URL || 'http://localhost:3000'}/invite/${token}` });
  });

  // Admin: Get Invite Links
  app.get('/api/admin/invites', authenticateToken, isAdmin, (req, res) => {
    const invites = db.prepare('SELECT * FROM invite_links ORDER BY created_at DESC').all();
    res.json(invites);
  });

  // Admin: Delete Invite Link
  app.delete('/api/admin/invites/:id', authenticateToken, isAdmin, (req, res) => {
    const inviteId = req.params.id;
    try {
      db.prepare('DELETE FROM invite_links WHERE id = ?').run(inviteId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting invite:', error);
      res.status(500).json({ error: 'خطا در حذف لینک دعوت' });
    }
  });

  // Admin: Deactivate Invite Link
  app.patch('/api/admin/invites/:id/deactivate', authenticateToken, isAdmin, (req, res) => {
    const inviteId = req.params.id;
    try {
      db.prepare('UPDATE invite_links SET expires_at = ? WHERE id = ?').run(new Date().toISOString(), inviteId);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deactivating invite:', error);
      res.status(500).json({ error: 'خطا در مسدود کردن لینک دعوت' });
    }
  });

  // Get user's conversation ID
  app.get('/api/user/conversation', authenticateToken, (req, res) => {
    const conv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(req.user.id) as any;
    if (conv) {
      res.json({ id: conv.id });
    } else {
      res.status(404).json({ error: 'Conversation not found' });
    }
  });

  // Get Messages
  app.get('/api/conversations/:id/messages', authenticateToken, (req, res) => {
    const conversationId = req.params.id;
    
    // Verify access
    if (req.user.role !== 'admin') {
      const conv = db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(conversationId) as any;
      if (!conv || conv.user_id !== req.user.id) {
        return res.status(403).json({ error: 'عدم دسترسی' });
      }
    }

    const now = new Date().toISOString();
    const messages = db.prepare(`
      SELECT m.*, u.role as sender_role 
      FROM messages m 
      JOIN users u ON m.sender_id = u.id 
      WHERE conversation_id = ? 
      AND (m.expires_at IS NULL OR m.expires_at > ?)
      ORDER BY m.created_at ASC
    `).all(conversationId, now);
    
    // Mark as read
    db.prepare('UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?').run(conversationId, req.user.id);
    
    res.json(messages);
  });

  // Upload File
  app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ url: fileUrl, name: req.file.originalname });
  });

  // Socket.io
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    
    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
      if (err) return next(new Error('Authentication error'));
      (socket as any).user = user;
      next();
    });
  });

  // Rate limiting map
  const messageRateLimits = new Map<number, number[]>();

  io.on('connection', (socket) => {
    const user = (socket as any).user;
    
    if (user.role === 'admin') {
      socket.join('admin_room');
      
      socket.on('join_conversation', ({ conversation_id }) => {
        socket.join(`conv_${conversation_id}`);
      });
    } else {
      socket.join(`user_${user.id}`);
      // Get conversation id
      const conv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(user.id) as any;
      if (conv) {
        socket.join(`conv_${conv.id}`);
      }
    }

    socket.on('send_message', (data) => {
      const { conversation_id, content, file_url, is_spoiler, expires_in_minutes } = data;
      
      // Rate limiting: max 5 messages per 10 seconds
      if (user.role !== 'admin') {
        const now = Date.now();
        const userLimits = messageRateLimits.get(user.id) || [];
        const recentMessages = userLimits.filter(time => now - time < 10000);
        
        if (recentMessages.length >= 5) {
          socket.emit('error', { message: 'شما بیش از حد مجاز پیام ارسال کرده‌اید. لطفا کمی صبر کنید.' });
          return;
        }
        
        recentMessages.push(now);
        messageRateLimits.set(user.id, recentMessages);
      }

      // Verify user can send to this conversation
      if (user.role !== 'admin') {
        const conv = db.prepare('SELECT id FROM conversations WHERE user_id = ?').get(user.id) as any;
        if (!conv || conv.id !== conversation_id) return;
        
        // Check if user is expired or banned
        const dbUser = db.prepare('SELECT is_banned, expires_at FROM users WHERE id = ?').get(user.id) as any;
        if (dbUser.is_banned) return;
        if (dbUser.expires_at && new Date(dbUser.expires_at) < new Date()) return;
      }

      let expiresAt = null;
      if (expires_in_minutes && user.role === 'admin') {
        expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + Number(expires_in_minutes));
      }

      const result = db.prepare('INSERT INTO messages (conversation_id, sender_id, content, file_url, is_spoiler, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        conversation_id, 
        user.id, 
        content, 
        file_url || null, 
        is_spoiler ? 1 : 0, 
        expiresAt ? expiresAt.toISOString() : null
      );
      const message = db.prepare('SELECT m.*, u.role as sender_role FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?').get(result.lastInsertRowid);

      io.to(`conv_${conversation_id}`).emit('new_message', message);
      
      if (user.role !== 'admin') {
        io.to('admin_room').emit('new_message_alert', { conversation_id, message });
      }
    });

    socket.on('typing', (data) => {
      const { conversation_id, isTyping } = data;
      if (user.role === 'admin') {
        io.to(`conv_${conversation_id}`).emit('admin_typing', { isTyping });
      } else {
        io.to('admin_room').emit('user_typing', { conversation_id, isTyping });
      }
    });

    socket.on('disconnect', () => {
      // Handle disconnect
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'خطای داخلی سرور' });
  });

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Background job to delete expired messages
  setInterval(() => {
    const now = new Date().toISOString();
    const expiredMessages = db.prepare('SELECT id, conversation_id FROM messages WHERE expires_at IS NOT NULL AND expires_at < ?').all(now) as any[];
    
    for (const msg of expiredMessages) {
      db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);
      io.to(`conv_${msg.conversation_id}`).emit('message_deleted', { messageId: msg.id });
    }
  }, 5000);
}

startServer();
