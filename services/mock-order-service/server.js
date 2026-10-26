const http = require('http');

const PORT = process.env.PORT || 9002;
const SERVICE_NAME = 'mock-order-service';

const orders = [
  { id: 'ord_1001', customer_id: 'usr_001', total: 149.99, status: 'completed', items: 3 },
  { id: 'ord_1002', customer_id: 'usr_002', total: 42.50, status: 'processing', items: 1 },
  { id: 'ord_1003', customer_id: 'usr_001', total: 890.00, status: 'shipped', items: 5 },
];

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  const latencyHeader = req.headers['x-simulate-latency-ms'];
  const delayMs = latencyHeader ? parseInt(latencyHeader, 10) : 0;

  const statusHeader = req.headers['x-simulate-status'];
  const forcedStatus = statusHeader ? parseInt(statusHeader, 10) : null;

  const handleResponse = () => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Served-By', SERVICE_NAME);

    if (forcedStatus) {
      res.writeHead(forcedStatus);
      res.end(JSON.stringify({ error: 'Simulated order failure', status: forcedStatus, service: SERVICE_NAME }));
      return;
    }

    if (pathname === '/healthz' || pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() }));
      return;
    }

    if (pathname.startsWith('/orders') || pathname.startsWith('/api/v1/orders')) {
      if (req.method === 'GET') {
        res.writeHead(200);
        res.end(JSON.stringify({ items: orders, count: orders.length, timestamp: new Date().toISOString() }));
        return;
      }
      if (req.method === 'POST') {
        res.writeHead(201);
        res.end(JSON.stringify({
          message: 'Order created',
          order: { id: `ord_${Date.now()}`, status: 'pending', total: 99.00 }
        }));
        return;
      }
    }

    res.writeHead(200);
    res.end(JSON.stringify({
      service: SERVICE_NAME,
      path: pathname,
      method: req.method,
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
