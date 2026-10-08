// Fetch a picture from another website, for text pasted into the flyer's text
// block. Pasted web pages and documents refer to their pictures by address;
// the flyer may only show this installation's own uploads, so each picture is
// copied in once, here, when it is pasted.
//
// The server makes the request, so it must never be pointed at itself or at
// the network it sits on (a cloud host's metadata service answers on a
// link-local address). Every connection, redirects included, resolves the
// host name through a lookup that refuses private, loopback, link-local and
// other non-public addresses. Checking at connect time, rather than resolving
// once beforehand, leaves no gap for a name that answers differently the
// second time it is asked.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import { sniffImage } from './images.js';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const MAX_REDIRECTS = 4;

export class RemoteImageError extends Error {}

function v4Blocked(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && ip.split('.')[2] === '0')
    || (a === 198 && (b === 18 || b === 19)); // benchmarking
}

// Whether an address is anywhere but the public internet.
export function isBlockedAddress(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return v4Blocked(ip);
  if (kind !== 6) return true;
  const lower = ip.toLowerCase();
  // An IPv4 address carried inside IPv6 is judged as the IPv4 address.
  const mapped = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return v4Blocked(mapped[1]);
  if (lower === '::' || lower === '::1') return true;
  if (/^::ffff:/.test(lower) || /^64:ff9b:/.test(lower)) return true; // hex-written mapped forms
  const first = parseInt(lower.split(':')[0] || '0', 16);
  return (first & 0xfe00) === 0xfc00 // unique local
    || (first & 0xffc0) === 0xfe80 // link-local
    || (first & 0xff00) === 0xff00; // multicast
}

// A dns.lookup that answers only with public addresses, for http.request.
function publicLookup(hostname, options, callback) {
  const opts = typeof options === 'object' && options ? options : { family: options };
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) { callback(err); return; }
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      callback(new RemoteImageError('That picture is on a private network address.'));
      return;
    }
    if (opts.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

function parseUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new RemoteImageError('That is not a web address.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new RemoteImageError('Only pictures on http:// or https:// addresses can be copied.');
  }
  // A host written as an address is never looked up, so check it here.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new RemoteImageError('That picture is on a private network address.');
  }
  return url;
}

function get(url, { allowPrivate }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      lookup: allowPrivate ? undefined : publicLookup,
      headers: { accept: 'image/*', 'user-agent': 'Soapbox picture copier' },
      timeout: TIMEOUT_MS,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        resolve({ redirect: new URL(res.headers.location, url).href });
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new RemoteImageError(`The website answered ${res.statusCode}.`));
        return;
      }
      if (Number(res.headers['content-length'] || 0) > MAX_BYTES) {
        res.destroy();
        reject(new RemoteImageError('That picture is larger than 5 MB.'));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          res.destroy();
          reject(new RemoteImageError('That picture is larger than 5 MB.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ buf: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new RemoteImageError('The website took too long to answer.')));
    req.on('error', (err) => reject(err instanceof RemoteImageError ? err : new RemoteImageError('The picture could not be fetched.')));
  });
}

// Returns { buf, mime } for a JPEG, PNG, GIF or WebP picture at `raw`.
// `allowPrivate` exists for the smoke test, which serves its picture from
// localhost; no route passes it.
export async function fetchRemoteImage(raw, { allowPrivate = false } = {}) {
  let url = parseUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const got = await get(url, { allowPrivate });
    if (got.redirect) {
      url = allowPrivate ? new URL(got.redirect) : parseUrl(got.redirect);
      continue;
    }
    const mime = sniffImage(got.buf);
    if (!mime) throw new RemoteImageError('That address is not a JPEG, PNG, GIF or WebP picture.');
    return { buf: got.buf, mime };
  }
  throw new RemoteImageError('The picture moved too many times.');
}
