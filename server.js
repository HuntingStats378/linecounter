const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Parse JSON payloads in POST requests
app.use(express.json());

// Environment variable for authentication
const PASSWORD = process.env.AUTH_PASSWORD;

// Serve static HTML files (like index.html)
app.use(express.static(path.join(__dirname, 'public')));

// Set to store active HTML client WebSocket connections
const htmlClients = new Set();

// Handle WebSocket connections from HTML clients
wss.on('connection', (ws, req) => {
    // Parse URL query parameters to authenticate frontend client
    const urlParams = new URLSearchParams(req.url.replace(/^.*\?/, ''));
    const token = urlParams.get('payload');

    if (token !== PASSWORD) {
        ws.close(1008, 'Unauthorized');
        return;
    }

    htmlClients.add(ws);

    ws.on('close', () => {
        htmlClients.delete(ws);
    });
});

// Broadcast line count update to all authenticated HTML clients
function broadcastLineCount(lines) {
    const data = JSON.stringify({ lines });
    for (const client of htmlClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    }
}

// POST endpoint for PC script to push line updates
// Endpoint pattern matching: /line?path=...
app.post('/line', (req, res) => {
    const { payload, lines } = req.body;

    if (payload !== PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized payload' });
    }

    if (typeof lines !== 'number') {
        return res.status(400).json({ error: 'Invalid lines value' });
    }

    broadcastLineCount(lines);
    return res.status(200).json({ status: 'success', broadcasted: lines });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
