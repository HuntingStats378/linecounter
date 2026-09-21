const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());

// Set AUTH_PASSWORD in Render Environment Variables
const PASSWORD = process.env.AUTH_PASSWORD;

app.use(express.static(path.join(__dirname, 'public')));

// Set to track clients: Set<{ ws, targetPath }>
const htmlClients = new Set();
// Cache latest count per path: { [filePath]: lineCount }
const pathCounts = {};

wss.on('connection', (ws, req) => {
    // Clean, standard URL parsing
    const host = req.headers.host || 'localhost';
    const parsedUrl = new URL(req.url, `http://${host}`);
    const token = parsedUrl.searchParams.get('payload');
    let targetPath = parsedUrl.searchParams.get('path');

    // Password verification log (useful in Render logs)
    if (!PASSWORD || token !== PASSWORD) {
        console.warn(`[WS] Connection rejected: Invalid or missing password payload.`);
        ws.close(1008, 'Unauthorized');
        return;
    }

    const clientMeta = { ws, targetPath };
    htmlClients.add(clientMeta);

    // Send latest cached count if available
    if (targetPath && pathCounts[targetPath] !== undefined) {
        ws.send(JSON.stringify({ lines: pathCounts[targetPath], path: targetPath }));
    }

    // Allow HTML client to switch tracked paths over open WS
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.action === 'subscribe' && data.path) {
                clientMeta.targetPath = data.path;
                targetPath = data.path;

                if (pathCounts[targetPath] !== undefined) {
                    ws.send(JSON.stringify({ lines: pathCounts[targetPath], path: targetPath }));
                }
            }
        } catch (err) {
            console.error('Invalid message format from client:', err);
        }
    });

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

// Endpoint for PC to query active requested paths
app.get('/active-paths', (req, res) => {
    const authHeader = req.headers['authorization'] || req.query.payload;
    if (authHeader !== PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const activePaths = Array.from(
        new Set([...htmlClients].map(c => c.targetPath).filter(Boolean))
    );

    return res.json({ paths: activePaths });
});

// Endpoint for PC to report line counts
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
