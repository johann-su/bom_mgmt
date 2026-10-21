import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicAddress } from "@/lib/net-guard";

// The order-link fetcher must never reach the app's own network.
test("private, loopback, link-local and metadata addresses are refused", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.10",
    "169.254.169.254", // cloud metadata endpoint
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fd00::1",
    "fe80::1%en0",
    "::ffff:127.0.0.1", // v4-mapped loopback
    "::ffff:7f00:1", // the same in hex form
    "64:ff9b::10.0.0.1",
    "not-an-ip",
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test("ordinary public addresses pass, including look-alikes of private ranges", () => {
  for (const ip of ["93.184.216.34", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2a00:1450:4001:80b::200e"]) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});
