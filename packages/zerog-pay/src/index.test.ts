import { test } from "node:test";
import assert from "node:assert/strict";
import { formatOg, memo, readMemo, verifyTransfer } from "./index";

const TO = "0x00000000000000000000000000000000000000aa";
const FROM = "0x00000000000000000000000000000000000000bb";
const H = `0x${"11".repeat(32)}` as const;
const client = (over: Record<string, unknown> = {}) => ({
  getChainId: async () => 16602,
  getTransaction: async () => ({ to: TO, from: FROM, value: 5_000n, input: memo("job", "job-abc123"), ...((over.tx as object) ?? {}) }),
  getTransactionReceipt: async () => ({ status: "success", blockNumber: 10n, ...((over.rc as object) ?? {}) }),
  getBlockNumber: async () => 12n,
  ...over,
}) as never;

test("memo round trip and refusal of foreign data", () => {
  assert.deepEqual(readMemo(memo("quote", "quote-abc123")), { kind: "quote", id: "quote-abc123" });
  assert.equal(readMemo("0x"), null);
  assert.equal(readMemo("0xa9059cbb"), null);
  assert.throws(() => memo("job", "../x"));
});

test("a matching transfer passes; each mismatch fails with a reason", async () => {
  const want = { hash: H, to: TO, from: FROM, minWei: 5_000n, memo: memo("job", "job-abc123") };
  assert.equal((await verifyTransfer(client(), want)).ok, true);
  for (const [over, why] of [
    [{ tx: { to: FROM } }, /different address/],
    [{ tx: { from: TO } }, /different wallet/],
    [{ tx: { value: 4_999n } }, /needed/],
    [{ tx: { input: memo("job", "job-other1") } }, /memo/],
    [{ rc: { status: "reverted" } }, /failed/],
    [{ getChainId: async () => 1 }, /Galileo/],
  ] as const) {
    const r = await verifyTransfer(client(over as never), want);
    assert.equal(r.ok, false);
    assert.match((r as { reason: string }).reason, why);
  }
});

test("formatOg", () => {
  assert.equal(formatOg(10n ** 18n), "1");
  assert.equal(formatOg(12_345_000_000_000n), "0.000012");
  assert.equal(formatOg(1_500_000_000_000_000_000n), "1.5");
});
