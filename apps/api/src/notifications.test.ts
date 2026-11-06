import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notesFor, NotificationStore, type TripMeta } from "./notifications";

const OWNER = "0x00000000000000000000000000000000000000Aa";
const CUSTOMER = "0x00000000000000000000000000000000000000Bb";
const trip: TripMeta = { taskId: "task-abc123", robotId: "rbt-1", robotName: "Dusty", ownerWallet: OWNER, customerWallet: CUSTOMER, skill: "home.cleaning", startAt: "2026-11-07T10:30:00.000Z" };
const to = (n: { to: string }[]) => n.map((x) => x.to).sort();

test("a booking tells the owner about the request and the customer it was sent", () => {
  const n = notesFor(trip, { kind: "dispatched" });
  assert.deepEqual(to(n), ["customer", "owner"]);
  assert.match(n.find((x) => x.to === "owner")!.body, /Dusty: Home cleaning, on site 10:30 UTC/);
});

test("the customer hears about the offer, the trip and the arrival; the owner about payment and arrival", () => {
  assert.match(notesFor(trip, { kind: "progress", state: "AWAITING_PAYMENT", detail: "pay 0.081 0G to 0xabc with memo …" })[0]!.body, /Pay 0.081 0G/);
  assert.deepEqual(to(notesFor(trip, { kind: "progress", state: "PAID", detail: "received 0.081 0G; agent budget 0.06 0G" })), ["customer", "owner"]);
  assert.equal(notesFor(trip, { kind: "position", phase: "TRAVELLING", remainingM: 5000 }).length, 0);
  assert.equal(notesFor(trip, { kind: "position", phase: "TRAVELLING", remainingM: 900 })[0]!.kind, "arriving");
  assert.deepEqual(to(notesFor(trip, { kind: "position", phase: "ARRIVED" })), ["customer", "owner"]);
  assert.deepEqual(to(notesFor(trip, { kind: "progress", state: "COMPLETED", detail: "visited kitchen" })), ["customer", "owner"]);
});

test("an owner test task only notifies the owner; an unpaid offer only the customer", () => {
  assert.deepEqual(to(notesFor({ ...trip, customerWallet: undefined }, { kind: "dispatched" })), ["owner"]);
  assert.deepEqual(to(notesFor(trip, { kind: "progress", state: "ABORTED", detail: "the quote was not paid before it expired" })), ["customer"]);
});

test("each kind is stored once per task and only its wallet can read it", () => {
  const s = new NotificationStore(join(mkdtempSync(join(tmpdir(), "notes-")), "n.db"));
  for (let i = 0; i < 3; i++) notesFor(trip, { kind: "position", phase: "TRAVELLING", remainingM: 800 - i * 100 }).forEach((n) => s.add(n));
  notesFor(trip, { kind: "dispatched" }).forEach((n) => s.add(n));
  const c = s.list(CUSTOMER);
  assert.equal(c.items.length, 2);
  assert.equal(c.unread, 2);
  assert.equal(s.list(OWNER).items.length, 1);
  s.markRead(CUSTOMER, [c.items[0]!.id]);
  assert.equal(s.list(CUSTOMER).unread, 1);
  s.markRead(OWNER, [c.items[1]!.id]); // someone else's id does nothing
  assert.equal(s.list(CUSTOMER).unread, 1);
});
