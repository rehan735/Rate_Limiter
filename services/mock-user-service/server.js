const http = require('http');

const PORT = process.env.PORT || 9001;
const SERVICE_NAME = 'mock-user-service';

const users = [
  { id: 'usr_001', name: 'Alice Walker', email: 'alice@example.com', role: 'admin', tier: 'enterprise' },
  { id: 'usr_002', name: 'Bob Stone', email: 'bob@example.com', role: 'member', tier: 'pro' },
  { id: 'usr_003', name: 'Charlie Kim', email: 'charlie@example.com', role: 'member', tier: 'free' },
];

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Simulate artificial latency if requested
  const latencyHeader = req.headers['x-simulate-latency-ms'];
  const delayMs = latencyHeader ? parseInt(latencyHeader, 10) : 0;

  // Simulate error status if requested
  const statusHeader = req.headers['x-simulate-status'];
  const forcedStatus = statusHeader ? parseInt(statusHeader, 10) : null;

  const handleResponse = () => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Served-By', SERVICE_NAME);

    if (forcedStatus) {
      res.writeHead(forcedStatus);
      res.end(JSON.stringify({ error: 'Forced simulated error', status: forcedStatus, service: SERVICE_NAME }));
      return;
    }

    if (pathname === '/healthz' || pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() }));
      return;
    }

    if (pathname.startsWith('/users') || pathname.startsWith('/api/v1/users')) {
      if (req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ items: users, count: users.length, timestamp: new Date().toISOString() }));
        return;
      }
      if (req.method === 'POST') {
        res.writeHead(201);
        res.end(JSON.stringify({ message: 'User created successfully', id: `usr_${Date.now()}` }));
        return;
      }
    }

    if (pathname.includes('/auth/login')) {
      res.writeHead(200);
      res.end(JSON.stringify({
        token: `jwt_sim_${Date.now()}`,
        expires_in: 3600,
        user: users[0]
      }));
      return;
    }

    // Default catch-all
    res.writeHead(200);
    res.end(JSON.stringify({
      service: SERVICE_NAME,
      path: pathname,
      method: req.method,
      message: 'Request handled by mock user service',
      timestamp: new Date().toISOString()
    }));
  };

  if (delayMs > 0) {
    setTimeout(handleResponse, delayMs);
  } else {
    handleResponse();
  }
});

server.listen(PORT, () => {
  console.log(`[${SERVICE_NAME}] Listening on port ${PORT}`);
});
