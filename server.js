const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

const PASSWORD = process.env.AUTH_PASSWORD;

app.use(express.static(path.join(__dirname, 'public')));

// Store client connections tagged with their requested path: Set<{ ws, targetPath }>
const htmlClients = new Set();

// Cache counts per path: { [filePath]: lineCount }
const pathCounts = {};

wss.on('connection', (ws, req) => {
    const urlParams = new URLSearchParams(req.url.replace(/^.*\?/, ''));
    const token = urlParams.get('payload');
    const targetPath = urlParams.get('path');

    if (token !== PASSWORD) {
        ws.close(1008, 'Unauthorized');
        return;
    }

    const clientMeta = { ws, targetPath };
    htmlClients.add(clientMeta);

    // Send latest cached count for this specific path if available
    if (targetPath && pathCounts[targetPath] !== undefined) {
        ws.send(JSON.stringify({ lines: pathCounts[targetPath], path: targetPath }));
    }

    ws.on('close', () => {
        htmlClients.delete(clientMeta);
    });
});

function broadcastLineCount(filePath, lines) {
    pathCounts[filePath] = lines;
    const data = JSON.stringify({ lines, path: filePath });

    for (const client of htmlClients) {
        if (client.targetPath === filePath && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(data);
        }
    }
}

// POST endpoint for PC script to push updates
// Expects: /line?path=C:/your/path.ndjson
app.post('/line', (req, res) => {
    const filePath = req.query.path;
    const { payload, lines } = req.body;

    if (payload !== PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized payload' });
    }

    if (!filePath) {
        return res.status(400).json({ error: 'Missing path query parameter' });
    }

    if (typeof lines !== 'number') {
        return res.status(400).json({ error: 'Invalid lines value' });
    }

    broadcastLineCount(filePath, lines);
    return res.status(200).json({ status: 'success', path: filePath, broadcasted: lines });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
