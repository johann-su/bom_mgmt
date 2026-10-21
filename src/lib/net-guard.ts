// Guards server-side fetches of user-supplied URLs (order links) against SSRF:
// the app server sits next to Postgres, the blob store and whatever else is
// on the LAN, so a "product page" at http://10.0.0.5/ or the cloud metadata
// endpoint must not be fetchable. Pure, so the address rules are unit-tested.

import { isIP } from "node:net";

/** True for addresses on the public internet; false for private, loopback, link-local, etc. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicV4(address);
  if (version !== 6) return false;

  const v6 = address.toLowerCase();
  // IPv4-mapped (::ffff:10.0.0.1) and NAT64 (64:ff9b::10.0.0.1) carry a v4 address.
  const embedded = v6.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded) return isPublicV4(embedded[1]);
  const groups = expandV6(v6);
  if (!groups) return false;
  const [first] = groups;
  if (groups.every((g) => g === 0)) return false; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return false; // ::1
  if (groups.slice(0, 5).every((g) => g === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    return false; // mapped/compatible v4 in hex form — don't bother decoding, refuse
  }
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (first === 0x64 && groups[1] === 0xff9b) return false; // NAT64 in hex form
  if (first === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  return true;
}

function isPublicV4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function expandV6(address: string): number[] | null {
  const zone = address.indexOf("%");
  const bare = zone === -1 ? address : address.slice(0, zone);
  const [head, tail] = bare.split("::");
  const parse = (part: string | undefined) => (part ? part.split(":").map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(tail);
  if (bare.includes("::")) {
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    return [...left, ...Array(fill).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}
