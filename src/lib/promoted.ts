/**
 * Slot "Promoted" di /leaderboard (P2.4, keputusan owner #7). Server saja.
 *
 * Alurnya sengaja manual untuk mulai: pembeli slot membayar ke treasury, owner memeriksa
 * pembayarannya sendiri, lalu menyetujui slot di `/admin` dengan tanda tangan. Server tidak
 * memverifikasi pembayaran; `paymentRef` hanya catatan owner (mis. hash tx). Versi x402 otomatis
 * menyusul tanpa mengubah worker x402 milik Plan 1.
 *
 * Paling banyak `PROMOTED_TERMS.slots` slot boleh tumpang tindih pada saat mana pun.
 */
import crypto from "node:crypto";
import { readJson, writeJson } from "@/lib/server-store";
import { findProject } from "@/lib/registry";
import { PROMOTED_TERMS } from "@/config/growth-programs";

const FILE = "promoted-slots.json";

export interface PromotedSlot {
  id: string;
  chainId: number;
  token: string;
  symbol: string;
  startsAt: number;
  endsAt: number;
  paymentRef: string;
  approvedBy: string;
  approvedAt: number;
  removedAt: number | null;
  removedBy: string | null;
}

interface SlotsFile {
  version: 1;
  slots: PromotedSlot[];
}

function load(): SlotsFile {
  const f = readJson<SlotsFile>(FILE, { version: 1, slots: [] });
  return Array.isArray(f?.slots) ? f : { version: 1, slots: [] };
}

const live = (s: PromotedSlot) => s.removedAt === null;

export function listSlots(): PromotedSlot[] {
  return load().slots.slice().sort((a, b) => b.startsAt - a.startsAt);
}

export function activeSlots(nowSeconds = Math.floor(Date.now() / 1000)): PromotedSlot[] {
  return load()
    .slots.filter((s) => live(s) && s.startsAt <= nowSeconds && nowSeconds < s.endsAt)
    .sort((a, b) => a.startsAt - b.startsAt)
    .slice(0, PROMOTED_TERMS.slots);
}

export type SlotResult = { ok: true; slot: PromotedSlot } | { ok: false; status: number; code: string; error: string };

export function approveSlot(p: { chainId: number; token: string; startsAt: number; hours: number; paymentRef: string; admin: string }): SlotResult {
  const project = findProject(p.token, p.chainId);
  if (!project || project.chainId !== p.chainId) return { ok: false, status: 404, code: "UNKNOWN_MARKET", error: "Not an ADEXTO market on this chain." };
  if (!Number.isInteger(p.hours) || p.hours < 1 || p.hours > 24 * 7) return { ok: false, status: 400, code: "BAD_HOURS", error: "hours must be 1 to 168." };
  if (!Number.isInteger(p.startsAt) || p.startsAt < Math.floor(Date.now() / 1000) - 3600) {
    return { ok: false, status: 400, code: "BAD_START", error: "startsAt must be a unix time no more than an hour in the past." };
  }
  const paymentRef = p.paymentRef.trim().slice(0, 200);
  if (!paymentRef) return { ok: false, status: 400, code: "NO_PAYMENT", error: "Note the payment (for example its tx hash)." };
  const endsAt = p.startsAt + p.hours * 3600;
  const file = load();
  const overlapping = file.slots.filter((s) => live(s) && s.startsAt < endsAt && p.startsAt < s.endsAt);
  if (overlapping.length >= PROMOTED_TERMS.slots) {
    return { ok: false, status: 409, code: "FULL", error: `All ${PROMOTED_TERMS.slots} slots are taken for part of that window.` };
  }
  const slot: PromotedSlot = {
    id: crypto.randomBytes(6).toString("hex"),
    chainId: p.chainId,
    token: project.tokenAddress.toLowerCase(),
    symbol: project.symbol,
    startsAt: p.startsAt,
    endsAt,
    paymentRef,
    approvedBy: p.admin,
    approvedAt: Math.floor(Date.now() / 1000),
    removedAt: null,
    removedBy: null,
  };
  file.slots.push(slot);
  if (!writeJson(FILE, file)) return { ok: false, status: 500, code: "STORE_FAILED", error: "Could not save the slot." };
  return { ok: true, slot };
}

export function removeSlot(id: string, admin: string): SlotResult {
  const file = load();
  const slot = file.slots.find((s) => s.id === id);
  if (!slot) return { ok: false, status: 404, code: "UNKNOWN_SLOT", error: "No slot with that id." };
  if (slot.removedAt === null) {
    slot.removedAt = Math.floor(Date.now() / 1000);
    slot.removedBy = admin;
    if (!writeJson(FILE, file)) return { ok: false, status: 500, code: "STORE_FAILED", error: "Could not save the change." };
  }
  return { ok: true, slot };
}
