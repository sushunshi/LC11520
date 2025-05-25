const express = require('express');
const session = require('express-session');
const socketio = require('socket.io');
const http = require('http');
const bcrypt = require('bcryptjs');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// 数据库配置
const db = require('better-sqlite3')('data.db');
db.pragma('journal_mode = WAL');

// 初始化数据库
db.exec(`
    CREATE TABLE IF NOT EXISTS responses (
        id INTEGER PRIMARY KEY,
        question INTEGER,
        answer TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT
    );
`);

// 插入初始管理员（首次运行后删除）
const adminExists = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
if (!adminExists) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO users (username, password) VALUES (?, ?)").run('admin', hash);
}

// 中间件配置
app.use(express.json());
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db' }),
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // HTTPS环境设为true
}));

// WebSocket连接
io.on('connection', (socket) => {
    console.log('Client connected');
    // 实时推送统计更新
    socket.on('requestUpdate', () => {
        const stats = getStatistics();
        socket.emit('dataUpdate', stats);
    });
});

// 获取统计数据
function getStatistics() {
    return {
        q1: db.prepare("SELECT answer, COUNT(*) as count FROM responses WHERE question=1 GROUP BY answer").all(),
        q2: db.prepare("SELECT answer, COUNT(*) as count FROM responses WHERE question=2 GROUP BY answer").all(),
        q3: db.prepare("SELECT answer, COUNT(*) as count FROM responses WHERE question=3 GROUP BY answer").all()
    };
}

// 管理员API
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    
    if (user && bcrypt.compareSync(password, user.password)) {
        req.session.auth = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: '认证失败' });
    }
});

app.post('/api/send-message', (req, res) => {
    if (!req.session.auth) return res.sendStatus(403);
    
    const { message } = req.body;
    db.prepare("INSERT INTO messages (content) VALUES (?)").run(message);
    io.emit('newMessage', message); // 推送给所有客户端
    res.json({ success: true });
});

// 管理后台路由
app.get('/admin', (req, res) => {
    if (!req.session.auth) return res.redirect('/login');
    res.sendFile(__dirname + '/admin.html');
});

app.get('/login', (req, res) => {
    res.sendFile(__dirname + '/login.html');
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});