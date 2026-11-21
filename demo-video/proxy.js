// Local authenticating forward proxy for Playwright/Chromium.
//
// Problem: the VM egress proxy (hatch-egress-proxy:3128) needs Basic auth.
// curl sends Proxy-Authorization preemptively (credentials in the URL) and
// works. Chromium (via Playwright's proxy option) waits for a 407 challenge,
// but this egress proxy closes the connection instead of issuing one, so
// Chromium gets ERR_TUNNEL_CONNECTION_FAILED. This local proxy sits on
// localhost, accepts Chromium's unauthenticated CONNECT/GET, and re-issues
// it to the egress proxy WITH preemptive Proxy-Authorization — exactly like
// curl does.
//
// The egress password rotates (~every 1-2 min), so this proxy reads it fresh
// from the environment at startup; run the capture immediately after starting
// it. The password is never logged or written anywhere.
// Usage: node proxy.js   (listens on 127.0.0.1:18080; Ctrl-C to stop)
const http = require('http');
const net = require('net');

const EGRESS_HOST = 'hatch-egress-proxy';
const EGRESS_PORT = 3128;

function egressAuth() {
  const u = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || '');
  return 'Basic ' + Buffer.from(
    decodeURIComponent(u.username) + ':' + decodeURIComponent(u.password)).toString('base64');
}

const server = http.createServer((req, res) => {
  // Plain HTTP through the proxy: forward the absolute-form request.
  const target = new URL(req.url);
  const headers = { ...req.headers, 'proxy-authorization': egressAuth(), host: target.host };
  delete headers['proxy-connection'];
  const preq = http.request({
    host: EGRESS_HOST, port: EGRESS_PORT, method: req.method,
    path: req.url, headers,
  }, (pres) => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); });
  preq.on('error', (e) => { if (!res.headersSent) res.writeHead(502); res.end('proxy error: ' + e.message); });
  req.pipe(preq);
});

server.on('connect', (req, clientSocket, head) => {
  // CONNECT tunnel: re-issue to the egress proxy with preemptive auth.
  const [host, port] = req.url.split(':');
  const upstream = net.connect(EGRESS_PORT, EGRESS_HOST, () => {
    upstream.write(
      `CONNECT ${req.url} HTTP/1.1\r\n` +
      `Host: ${req.url}\r\n` +
      `Proxy-Authorization: ${egressAuth()}\r\n` +
      `Proxy-Connection: Keep-Alive\r\n\r\n`);
  });
  let established = false;
  let buf = Buffer.alloc(0);
  const onUpstreamData = (chunk) => {
    if (established) return;
    buf = Buffer.concat([buf, chunk]);
    const end = buf.indexOf('\r\n\r\n');
    if (end === -1) return;
    const head0 = buf.slice(0, end).toString();
    const status = parseInt((head0.split('\r\n')[0].match(/HTTP\/\d\.\d (\d+)/) || [])[1] || '0', 10);
    if (status !== 200) {
      clientSocket.end(`HTTP/1.1 ${status} Proxy Error\r\n\r\n`);
      upstream.destroy();
      return;
    }
    established = true;
    // Remove this listener BEFORE piping, or every byte gets forwarded
    // twice (once by this handler, once by the pipe) and TLS breaks.
    upstream.removeListener('data', onUpstreamData);
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    const rest = buf.slice(end + 4);
    if (head && head.length) upstream.write(head);
    if (rest.length) clientSocket.write(rest);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  };
  upstream.on('data', onUpstreamData);
  upstream.on('error', () => { if (!established) clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(18080, '127.0.0.1', () => console.log('forward proxy on 127.0.0.1:18080'));
