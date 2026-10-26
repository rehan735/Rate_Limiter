const http = require('http');

const PORT = process.env.PORT || 9003;
const SERVICE_NAME = 'mock-payment-service';

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
      res.end(JSON.stringify({ error: 'Simulated payment processing failure', status: forcedStatus, service: SERVICE_NAME }));
      return;
    }

    if (pathname === '/healthz' || pathname === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ status: 'ok', service: SERVICE_NAME, timestamp: new Date().toISOString() }));
      return;
    }

    if (pathname.includes('/payments/charge') || pathname.startsWith('/payments')) {
      if (req.method === 'POST') {
        const txnId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        res.writeHead(200);
        res.end(JSON.stringify({
          status: 'succeeded',
          transaction_id: txnId,
          amount_cents: 5000,
          currency: 'usd',
          timestamp: new Date().toISOString()
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
