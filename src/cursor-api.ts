import { closeSync, existsSync, fstatSync, openSync, readSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { IncludedUnit } from "./format";

export type UsagePayload = {
  includedRequests: {
    used: number;
    limit: number;
    unit: IncludedUnit;
    /** Base named-model API pool (cents), when summary provides breakdown. */
    apiUsed?: number;
    apiLimit?: number;
    bonusCents?: number | null;
    apiPercentUsed?: number | null;
    autoPercentUsed?: number | null;
    totalPercentUsed?: number | null;
  };
  onDemand: {
    state: "disabled" | "limited" | "unlimited";
    spendDollars: number;
    limitDollars: number | null;
  };
  resetsAt: string | null;
};

export type UsageEvent = {
  timestamp: number;
  model: string;
  kind: string;
  totalTokens: number;
  requests: number;
  spendCents: number;
  maxMode: boolean;
};

export type DailySpendRow = {
  day: number;
  category: string;
  spendCents: number;
  totalTokens: number;
};

type Logger = (msg: string) => void;

let log: Logger = () => {};

export function configure(opts: { logger: Logger }) {
  log = opts.logger;
}

function getDbPath(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    case "win32":
      return join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"), "Cursor/User/globalStorage/state.vscdb");
    default:
      return join(homedir(), ".config/Cursor/User/globalStorage/state.vscdb");
  }
}

type AuthInfo = { userId: string; sessionToken: string; email: string | null };

let cachedAuth: { info: AuthInfo | null; ts: number } = { info: null, ts: 0 };
const AUTH_CACHE_TTL = 10_000;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_USAGE_EVENT_PAGES = 10;

const CURSOR_AUTH_KEYS = ["cursorAuth/accessToken", "cursorAuth/cachedEmail"] as const;
type CursorAuthKey = (typeof CURSOR_AUTH_KEYS)[number];
type CursorAuthValues = Partial<Record<CursorAuthKey, string>>;

type Varint = { value: number; nextOffset: number };
type SqliteValue = number | string | null;
type DecodedField = { value: SqliteValue; byteLength: number };
type WalIndex = { fd: number; pages: Map<number, number> };

function decodeVarint(buffer: Buffer, offset: number, limit = buffer.length): Varint | null {
  let value = 0;
  for (let i = 0; i < 8 && offset + i < limit; i++) {
    const byte = buffer[offset + i];
    if (byte === undefined) return null;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value, nextOffset: offset + i + 1 };
    }
  }

  if (offset + 8 < limit) {
    const byte = buffer[offset + 8];
    return byte === undefined ? null : { value: value * 256 + byte, nextOffset: offset + 9 };
  }
  return null;
}

function sqliteFieldByteLength(serialType: number): number | null {
  if (serialType === 0 || serialType === 8 || serialType === 9) return 0;
  if (serialType >= 1 && serialType <= 4) return serialType;
  if (serialType === 5) return 6;
  if (serialType === 6 || serialType === 7) return 8;
  if (serialType >= 12) return Math.floor((serialType - 12) / 2);
  return null;
}

function readSignedInt(buffer: Buffer, offset: number, byteLength: number): number | null {
  if (byteLength === 0) return 0;
  if (offset + byteLength > buffer.length) return null;

  let value = 0;
  for (let i = 0; i < byteLength; i++) {
    const byte = buffer[offset + i];
    if (byte === undefined) return null;
    value = value * 256 + byte;
  }

  const signBit = 2 ** (byteLength * 8 - 1);
  return value >= signBit ? value - 2 ** (byteLength * 8) : value;
}

function readSqliteField(buffer: Buffer, offset: number, serialType: number): DecodedField | null {
  const byteLength = sqliteFieldByteLength(serialType);
  if (byteLength === null || offset + byteLength > buffer.length) return null;
  if (serialType === 0) return { value: null, byteLength };
  if (serialType === 8) return { value: 0, byteLength };
  if (serialType === 9) return { value: 1, byteLength };
  if (serialType >= 1 && serialType <= 6) {
    const value = readSignedInt(buffer, offset, byteLength);
    return value === null ? null : { value, byteLength };
  }
  if (serialType === 7) return { value: null, byteLength };
  if (serialType % 2 === 0) return { value: null, byteLength };
  return {
    value: buffer.toString("utf8", offset, offset + byteLength),
    byteLength,
  };
}

function readSqliteRecord(page: Buffer, payloadOffset: number, payloadSize: number): SqliteValue[] | null {
  if (payloadOffset + payloadSize > page.length) return null;

  const headerSizeVarint = decodeVarint(page, payloadOffset, payloadOffset + payloadSize);
  if (!headerSizeVarint) return null;

  const headerEnd = payloadOffset + headerSizeVarint.value;
  if (headerEnd > payloadOffset + payloadSize) return null;

  const serialTypes: number[] = [];
  let serialOffset = headerSizeVarint.nextOffset;
  while (serialOffset < headerEnd) {
    const serialType = decodeVarint(page, serialOffset, headerEnd);
    if (!serialType) return null;
    serialTypes.push(serialType.value);
    serialOffset = serialType.nextOffset;
  }

  const values: SqliteValue[] = [];
  let fieldOffset = headerEnd;
  for (const serialType of serialTypes) {
    const field = readSqliteField(page, fieldOffset, serialType);
    if (!field) return null;
    values.push(field.value);
    fieldOffset += field.byteLength;
  }
  return values;
}

function readTableLeafRecord(page: Buffer, cellOffset: number): SqliteValue[] | null {
  if (cellOffset >= page.length) return null;
  const payloadSize = decodeVarint(page, cellOffset);
  if (!payloadSize) return null;

  const rowId = decodeVarint(page, payloadSize.nextOffset);
  if (!rowId) return null;

  return readSqliteRecord(page, rowId.nextOffset, payloadSize.value);
}

function readItemTableLeafCell(page: Buffer, cellOffset: number): [string, string] | null {
  const record = readTableLeafRecord(page, cellOffset);
  if (!record || record.length < 2) return null;

  const [key, value] = record;
  return typeof key === "string" && typeof value === "string" ? [key, value] : null;
}

function getSqlitePageSize(header: Buffer, walPageSize?: number): number {
  if (walPageSize && walPageSize > 0) return walPageSize;

  const pageSize = header.readUInt16BE(16);
  return pageSize === 1 ? 65_536 : pageSize;
}

function indexWalFile(dbPath: string, pageSize: number): WalIndex | null {
  const walPath = `${dbPath}-wal`;
  if (!existsSync(walPath)) return null;

  const fd = openSync(walPath, "r");
  const size = fstatSync(fd).size;
  if (size < 32) return { fd, pages: new Map() };

  const header = Buffer.alloc(32);
  readSync(fd, header, 0, header.length, 0);
  const magic = header.readUInt32BE(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) {
    closeSync(fd);
    return null;
  }

  const pages = new Map<number, number>();
  const frameSize = 24 + pageSize;
  for (let frameOffset = 32; frameOffset + frameSize <= size; frameOffset += frameSize) {
    const frameHeader = Buffer.alloc(4);
    readSync(fd, frameHeader, 0, frameHeader.length, frameOffset);
    const pageNumber = frameHeader.readUInt32BE(0);
    if (pageNumber > 0) {
      pages.set(pageNumber, frameOffset + 24);
    }
  }

  return { fd, pages };
}

function getCellPointerOffset(pageType: number, btreeHeaderOffset: number): number {
  return btreeHeaderOffset + (pageType === 0x05 ? 12 : 8);
}

function readPage(
  dbFd: number,
  walIndex: WalIndex | null,
  pageNumber: number,
  pageSize: number,
): Buffer | null {
  const page = Buffer.alloc(pageSize);
  const walOffset = walIndex?.pages.get(pageNumber);
  const bytesRead = walOffset === undefined || !walIndex
    ? readSync(dbFd, page, 0, pageSize, (pageNumber - 1) * pageSize)
    : readSync(walIndex.fd, page, 0, pageSize, walOffset);

  if (bytesRead <= 0) return null;
  return bytesRead === pageSize ? page : page.subarray(0, bytesRead);
}

function collectTableLeafRecords(
  readDbPage: (pageNumber: number) => Buffer | null,
  rootPage: number,
  onRecord: (record: SqliteValue[]) => boolean,
  seenPages = new Set<number>(),
): void {
  if (seenPages.has(rootPage)) return;
  seenPages.add(rootPage);

  const page = readDbPage(rootPage);
  if (!page) return;

  const btreeHeaderOffset = rootPage === 1 ? 100 : 0;
  const pageType = page[btreeHeaderOffset];
  if (pageType !== 0x05 && pageType !== 0x0d) return;

  const cellCount = page.readUInt16BE(btreeHeaderOffset + 3);
  const cellPointerOffset = getCellPointerOffset(pageType, btreeHeaderOffset);

  if (pageType === 0x05) {
    for (let i = 0; i < cellCount; i++) {
      const pointerOffset = cellPointerOffset + i * 2;
      if (pointerOffset + 2 > page.length) break;
      const cellOffset = page.readUInt16BE(pointerOffset);
      if (cellOffset + 4 > page.length) continue;
      collectTableLeafRecords(readDbPage, page.readUInt32BE(cellOffset), onRecord, seenPages);
    }

    const rightMostPage = page.readUInt32BE(btreeHeaderOffset + 8);
    collectTableLeafRecords(readDbPage, rightMostPage, onRecord, seenPages);
    return;
  }

  for (let i = 0; i < cellCount; i++) {
    const pointerOffset = cellPointerOffset + i * 2;
    if (pointerOffset + 2 > page.length) break;
    const record = readTableLeafRecord(page, page.readUInt16BE(pointerOffset));
    if (record && !onRecord(record)) return;
  }
}

function findItemTableRootPage(readDbPage: (pageNumber: number) => Buffer | null): number | null {
  let rootPage: number | null = null;
  collectTableLeafRecords(readDbPage, 1, (record) => {
    const [type, name, , page] = record;
    if (type === "table" && name === "ItemTable" && typeof page === "number" && page > 0) {
      rootPage = page;
      return false;
    }
    return true;
  });
  return rootPage;
}

export function readCursorAuthValuesFromDb(dbPath: string): CursorAuthValues {
  const fd = openSync(dbPath, "r");
  let walIndex: WalIndex | null = null;
  try {
    const header = Buffer.alloc(100);
    readSync(fd, header, 0, header.length, 0);

    if (header.toString("utf8", 0, 16) !== "SQLite format 3\0") {
      throw new Error("Invalid SQLite database header");
    }

    const pageSize = getSqlitePageSize(header);
    walIndex = indexWalFile(dbPath, pageSize);
    const readDbPage = (pageNumber: number) => readPage(fd, walIndex, pageNumber, pageSize);
    const itemTableRootPage = findItemTableRootPage(readDbPage);
    if (itemTableRootPage === null) {
      throw new Error("Could not find ItemTable root page");
    }

    const remainingKeys = new Set<CursorAuthKey>(CURSOR_AUTH_KEYS);
    const values: CursorAuthValues = {};

    collectTableLeafRecords(readDbPage, itemTableRootPage, (record) => {
      if (record.length < 2) return true;
      const [key, value] = record;
      if (typeof key === "string" && typeof value === "string" && remainingKeys.has(key as CursorAuthKey)) {
        const authKey = key as CursorAuthKey;
        values[authKey] = value;
        remainingKeys.delete(authKey);
      }
      return remainingKeys.size > 0;
    });

    return values;
  } finally {
    if (walIndex) closeSync(walIndex.fd);
    closeSync(fd);
  }
}

async function getCursorToken(): Promise<AuthInfo | null> {
  if (cachedAuth.info && Date.now() - cachedAuth.ts < AUTH_CACHE_TTL) {
    log("Using cached auth token");
    return cachedAuth.info;
  }

  const dbPath = getDbPath();
  log(`DB path: ${dbPath}`);

  if (!existsSync(dbPath)) {
    log("Database file does not exist");
    return null;
  }

  let authValues: CursorAuthValues;
  try {
    authValues = readCursorAuthValuesFromDb(dbPath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    log(`Could not read accessToken from database: ${msg}`);
    return null;
  }

  const jwt = authValues["cursorAuth/accessToken"] ?? null;
  if (!jwt) {
    log("No accessToken found in database");
    return null;
  }

  log(`Found JWT token (${jwt.length} chars)`);
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64").toString());
  const userId: string = payload.sub.split("|")[1];
  log(`Parsed userId: ${userId}`);

  const email = authValues["cursorAuth/cachedEmail"] ?? null;
  log(`Cached email: ${email}`);

  const info = { userId, sessionToken: `${userId}%3A%3A${jwt}`, email };
  cachedAuth = { info, ts: Date.now() };
  return info;
}

function cursorHeaders(sessionToken: string) {
  return {
    "Content-Type": "application/json",
    Cookie: `WorkosCursorSessionToken=${sessionToken}`,
    Origin: "https://cursor.com",
    Referer: "https://cursor.com/dashboard",
  } as const;
}

function nextMonth(iso: string): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

type RequestTotals = { used: number; limit: number; source: string };
type NumberWithSource = { value: number; source: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function withTimeout(init: RequestInit = {}): RequestInit {
  return { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function extractBucketTotals(bucket: Record<string, unknown>, source: string): RequestTotals | null {
  const used =
    toNumber(bucket.numRequests) ??
    toNumber(bucket.usedRequests) ??
    toNumber(bucket.requestsUsed) ??
    toNumber(bucket.includedRequestsUsed);

  const limit =
    toNumber(bucket.maxRequestUsage) ??
    toNumber(bucket.maxRequests) ??
    toNumber(bucket.requestLimit) ??
    toNumber(bucket.includedRequestLimit);

  if (used === null && limit === null) return null;
  return { used: used ?? 0, limit: limit ?? 0, source };
}

function pickBestTotals(candidates: RequestTotals[]): RequestTotals | null {
  if (candidates.length === 0) return null;
  const [best] = [...candidates].sort((a, b) => {
    const aScore = Number(a.limit > 0) + Number(a.used > 0);
    const bScore = Number(b.limit > 0) + Number(b.used > 0);
    if (aScore !== bScore) return bScore - aScore;
    if (a.limit !== b.limit) return b.limit - a.limit;
    return b.used - a.used;
  });
  return best ?? null;
}

function extractUsageTotals(usageRaw: unknown): RequestTotals {
  const usage = asRecord(usageRaw);
  if (!usage) {
    log("Usage payload is not an object; defaulting totals to 0/0");
    return { used: 0, limit: 0, source: "none" };
  }

  const keys = Object.keys(usage);
  log(`Usage keys: ${keys.length > 0 ? keys.join(", ") : "(none)"}`);

  const gpt4 = asRecord(usage["gpt-4"]);
  const gpt4Totals = gpt4 ? extractBucketTotals(gpt4, "gpt-4") : null;

  const dynamicCandidates: RequestTotals[] = [];
  const rootTotals = extractBucketTotals(usage, "root");
  if (rootTotals) dynamicCandidates.push(rootTotals);

  for (const [key, value] of Object.entries(usage)) {
    if (key === "gpt-4") continue;
    const bucket = asRecord(value);
    if (!bucket) continue;
    const totals = extractBucketTotals(bucket, key);
    if (totals) dynamicCandidates.push(totals);
  }

  const bestDynamic = pickBestTotals(dynamicCandidates);
  if (!gpt4Totals && !bestDynamic) {
    log("Could not parse usage totals from payload; defaulting to 0/0");
    return { used: 0, limit: 0, source: "none" };
  }

  if (gpt4Totals && !bestDynamic) {
    log(`Using usage bucket: ${gpt4Totals.source} (${gpt4Totals.used}/${gpt4Totals.limit})`);
    return gpt4Totals;
  }

  if (!gpt4Totals && bestDynamic) {
    log(`Using usage bucket: ${bestDynamic.source} (${bestDynamic.used}/${bestDynamic.limit})`);
    return bestDynamic;
  }

  if (gpt4Totals && bestDynamic) {
    const chooseDynamic =
      bestDynamic.limit > gpt4Totals.limit ||
      (bestDynamic.limit === gpt4Totals.limit && bestDynamic.used > gpt4Totals.used);

    const selected = chooseDynamic ? bestDynamic : gpt4Totals;
    log(`Using usage bucket: ${selected.source} (${selected.used}/${selected.limit})`);
    return selected;
  }

  return { used: 0, limit: 0, source: "none" };
}

function pickNumber(record: Record<string, unknown>, fields: string[]): NumberWithSource | null {
  for (const field of fields) {
    const value = toNumber(record[field]);
    if (value !== null) {
      return { value, source: field };
    }
  }
  return null;
}

function extractTeamUsedRequests(member: Record<string, unknown>): NumberWithSource {
  return (
    pickNumber(member, [
      "includedRequestsUsed",
      "numRequests",
      "requestsUsed",
      "fastPremiumRequests",
    ]) ?? { value: 0, source: "fallback:0" }
  );
}

function extractTeamRequestLimit(
  member: Record<string, unknown>,
  fallbackLimit: number,
): NumberWithSource {
  return (
    pickNumber(member, ["includedRequestLimit", "maxRequestUsage"]) ?? {
      value: fallbackLimit,
      source: "setup.maxRequestUsage",
    }
  );
}

type SetupCache = {
  isTeamMember: boolean;
  teamId?: number;
  maxRequestUsage: number;
  onDemandEnabled: boolean;
};

let cachedSetup: SetupCache | null = null;

export function isTeamMemberCached(): boolean {
  return cachedSetup?.isTeamMember ?? false;
}

export type UsageSummaryBreakdown = {
  included: number;
  bonus: number;
  total: number;
};

export type UsageSummaryPlan = {
  used: number;
  limit: number;
  remaining: number | null;
  enabled: boolean;
  breakdown: UsageSummaryBreakdown | null;
  totalPercentUsed: number | null;
  apiPercentUsed: number | null;
  autoPercentUsed: number | null;
};

export type UsageSummaryOnDemand = {
  enabled: boolean;
  usedCents: number;
  limitCents: number | null;
};

export type ParsedUsageSummary = {
  plan: UsageSummaryPlan | null;
  onDemand: UsageSummaryOnDemand | null;
  billingCycleEnd: string | null;
  membershipType: string | null;
  limitType: string | null;
};

function parseUsageSummaryBreakdown(raw: unknown): UsageSummaryBreakdown | null {
  const breakdown = asRecord(raw);
  if (!breakdown) return null;
  const included = toNumber(breakdown.included);
  const bonus = toNumber(breakdown.bonus);
  const total = toNumber(breakdown.total);
  if (included === null || bonus === null || total === null || total <= 0) return null;
  return { included, bonus, total };
}

function parseUsageSummaryPlan(planRaw: unknown): UsageSummaryPlan | null {
  const plan = asRecord(planRaw);
  if (!plan || plan.enabled === false) return null;
  const used = toNumber(plan.used);
  const limit = toNumber(plan.limit);
  if (used === null || limit === null) return null;
  return {
    used,
    limit,
    remaining: toNumber(plan.remaining),
    enabled: true,
    breakdown: parseUsageSummaryBreakdown(plan.breakdown),
    totalPercentUsed: toNumber(plan.totalPercentUsed),
    apiPercentUsed: toNumber(plan.apiPercentUsed),
    autoPercentUsed: toNumber(plan.autoPercentUsed),
  };
}

function parseUsageSummaryOnDemand(onDemandRaw: unknown): UsageSummaryOnDemand | null {
  const onDemand = asRecord(onDemandRaw);
  if (!onDemand) return null;
  const usedCents = toNumber(onDemand.used) ?? 0;
  const limitCents = toNumber(onDemand.limit);
  return {
    enabled: Boolean(onDemand.enabled),
    usedCents,
    limitCents,
  };
}

/**
 * Prefer included+bonus total pool when breakdown is present.
 * Total used is derived from official totalPercentUsed (no absolute field in API).
 */
export function resolveIncludedDisplay(plan: UsageSummaryPlan): {
  used: number;
  limit: number;
  apiUsed: number;
  apiLimit: number;
  bonusCents: number | null;
} {
  const apiUsed = plan.used;
  const apiLimit = plan.limit;
  if (plan.breakdown && plan.totalPercentUsed !== null) {
    const used = Math.round((plan.totalPercentUsed / 100) * plan.breakdown.total);
    return {
      used: Math.min(used, plan.breakdown.total),
      limit: plan.breakdown.total,
      apiUsed,
      apiLimit,
      bonusCents: plan.breakdown.bonus,
    };
  }
  return {
    used: apiUsed,
    limit: apiLimit,
    apiUsed,
    apiLimit,
    bonusCents: plan.breakdown?.bonus ?? null,
  };
}

/** Pure parser for GET /api/usage-summary — plan/onDemand amounts are cents. */
export function parseUsageSummary(raw: unknown): ParsedUsageSummary | null {
  const data = asRecord(raw);
  if (!data) return null;

  const individual = asRecord(data.individualUsage);
  const plan = individual ? parseUsageSummaryPlan(individual.plan) : null;
  const onDemand = individual ? parseUsageSummaryOnDemand(individual.onDemand) : null;
  const billingCycleEnd = typeof data.billingCycleEnd === "string" ? data.billingCycleEnd : null;
  const membershipType = typeof data.membershipType === "string" ? data.membershipType : null;
  const limitType = typeof data.limitType === "string" ? data.limitType : null;

  if (!plan && !onDemand) return null;

  return { plan, onDemand, billingCycleEnd, membershipType, limitType };
}

/** usage-summary carries its own On-Demand flag; it wins over the legacy stripe flag. */
export function usagePayloadFromSummary(summary: ParsedUsageSummary): UsagePayload | null {
  if (!summary.plan) return null;

  const onDemandApi = summary.onDemand;
  let onDemand: UsagePayload["onDemand"];
  if (!onDemandApi || !onDemandApi.enabled) {
    onDemand = { state: "disabled", spendDollars: 0, limitDollars: null };
  } else if (onDemandApi.limitCents !== null && onDemandApi.limitCents > 0) {
    onDemand = {
      state: "limited",
      spendDollars: onDemandApi.usedCents / 100,
      limitDollars: onDemandApi.limitCents / 100,
    };
  } else {
    onDemand = {
      state: "unlimited",
      spendDollars: onDemandApi.usedCents / 100,
      limitDollars: null,
    };
  }

  const included = resolveIncludedDisplay(summary.plan);

  return {
    includedRequests: {
      used: included.used,
      limit: included.limit,
      unit: "cents",
      apiUsed: included.apiUsed,
      apiLimit: included.apiLimit,
      bonusCents: included.bonusCents,
      apiPercentUsed: summary.plan.apiPercentUsed,
      autoPercentUsed: summary.plan.autoPercentUsed,
      totalPercentUsed: summary.plan.totalPercentUsed,
    },
    onDemand,
    resetsAt: summary.billingCycleEnd,
  };
}

async function fetchUsageSummary(
  headers: ReturnType<typeof cursorHeaders>,
): Promise<ParsedUsageSummary | null> {
  log("Fetching /api/usage-summary...");
  const res = await fetch("https://cursor.com/api/usage-summary", withTimeout({ headers }));
  log(`usage-summary status: ${res.status}`);
  if (!res.ok) return null;
  const raw = await res.json();
  const parsed = parseUsageSummary(raw);
  if (!parsed) {
    log("usage-summary payload could not be parsed");
    return null;
  }
  if (parsed.plan) {
    const display = resolveIncludedDisplay(parsed.plan);
    log(
      `usage-summary plan: api=${parsed.plan.used}/${parsed.plan.limit}c totalDisplay=${display.used}/${display.limit}c bonus=${display.bonusCents ?? 0}c`,
    );
  }
  if (parsed.onDemand) {
    log(
      `usage-summary onDemand: enabled=${parsed.onDemand.enabled} used=${parsed.onDemand.usedCents}c limit=${parsed.onDemand.limitCents ?? "∞"}`,
    );
  }
  return parsed;
}

async function ensureSetup(
  userId: string,
  headers: ReturnType<typeof cursorHeaders>,
): Promise<SetupCache | null> {
  if (cachedSetup) return cachedSetup;

  log("Running one-time setup (stripe + usage)...");
  const [stripeRes, usageRes] = await Promise.all([
    fetch("https://cursor.com/api/auth/stripe", withTimeout({ headers })),
    fetch(`https://cursor.com/api/usage?user=${userId}`, withTimeout({ headers })),
  ]);

  log(`Setup: Stripe ${stripeRes.status}, Usage ${usageRes.status}`);

  const stripe = stripeRes.ok ? await stripeRes.json() : null;
  const usage = usageRes.ok ? await usageRes.json() : null;
  const totals = extractUsageTotals(usage);

  const setup: SetupCache = {
    isTeamMember: !!(stripe?.isTeamMember && stripe.teamId),
    teamId: stripe?.teamId,
    maxRequestUsage: totals.limit > 0 ? totals.limit : totals.used,
    onDemandEnabled: Boolean(stripe?.isOnBillableAuto),
  };

  // Never cache a stripe failure: it would pin onDemandEnabled=false for the whole session.
  if (stripe) {
    cachedSetup = setup;
  }

  log(
    `Setup ${stripe ? "cached" : "not cached (stripe unavailable)"}: team=${setup.isTeamMember}, teamId=${setup.teamId}, maxReq=${setup.maxRequestUsage}, onDemandEnabled=${setup.onDemandEnabled}`,
  );
  return setup;
}

export async function fetchUsageData(): Promise<UsagePayload | null> {
  log("--- Fetching usage data ---");

  const auth = await getCursorToken();
  if (!auth) {
    log("Failed to get auth token");
    return null;
  }

  const headers = cursorHeaders(auth.sessionToken);
  const setup = await ensureSetup(auth.userId, headers);
  if (!setup) {
    log("Setup failed");
    return null;
  }

  const summary = await fetchUsageSummary(headers);
  if (summary) {
    const fromSummary = usagePayloadFromSummary(summary);
    if (fromSummary) {
      const spendLimitLabel = fromSummary.onDemand.state === "unlimited"
        ? "∞"
        : fromSummary.onDemand.state === "disabled"
          ? "hidden"
          : `$${(fromSummary.onDemand.limitDollars ?? 0).toFixed(2)}`;
      log(
        `Result (usage-summary): $${(fromSummary.includedRequests.used / 100).toFixed(2)}/$${(fromSummary.includedRequests.limit / 100).toFixed(2)} included, $${fromSummary.onDemand.spendDollars.toFixed(2)}/${spendLimitLabel} on-demand`,
      );
      return fromSummary;
    }
  }

  log("usage-summary unavailable; falling back to legacy usage endpoints");
  if (setup.isTeamMember) {
    return fetchTeamUsage(auth, headers, setup);
  }
  return fetchSoloUsage(auth, headers, setup);
}

async function fetchTeamUsage(
  auth: AuthInfo,
  headers: ReturnType<typeof cursorHeaders>,
  setup: SetupCache,
): Promise<UsagePayload | null> {
  const [teamSpendRes, usageRes] = await Promise.all([
    fetch("https://cursor.com/api/dashboard/get-team-spend", withTimeout({
      method: "POST",
      headers,
      body: JSON.stringify({ teamId: setup.teamId }),
    })),
    fetch(`https://cursor.com/api/usage?user=${auth.userId}`, withTimeout({ headers })),
  ]);

  if (!teamSpendRes.ok) {
    log(`get-team-spend failed: ${teamSpendRes.status}`);
    return null;
  }

  let usageTotals: RequestTotals | null = null;
  if (usageRes.ok) {
    const usage = await usageRes.json();
    usageTotals = extractUsageTotals(usage);
  } else {
    log(`Usage API failed in team mode: ${usageRes.status}`);
  }

  const data = await teamSpendRes.json();
  const dataRecord = asRecord(data) ?? {};
  const members: unknown[] = Array.isArray(dataRecord.teamMemberSpend) ? dataRecord.teamMemberSpend : [];
  const me = members.find((member) => {
    const record = asRecord(member);
    return record && (record.email === auth.email || String(record.userId) === auth.userId);
  });

  if (!me) {
    log(`Could not find current user in team spend (email=${auth.email}, userId=${auth.userId})`);
    return null;
  }

  const nextCycleStart = toNumber(dataRecord.nextCycleStart);
  const resetsAt = nextCycleStart !== null
    ? new Date(nextCycleStart).toISOString()
    : null;

  const meRecord = asRecord(me) ?? {};
  log(`Team member keys: ${Object.keys(meRecord).join(", ") || "(none)"}`);

  const includedSpendCents = toNumber(meRecord.includedSpendCents);
  const memberUsed = extractTeamUsedRequests(meRecord);
  const memberLimit = extractTeamRequestLimit(meRecord, setup.maxRequestUsage);

  // Prefer modern includedSpendCents (cents) when legacy request counters are absent.
  const useCentsPool = includedSpendCents !== null
    && !(usageTotals && usageTotals.used > 0)
    && memberUsed.source === "fallback:0";

  let used: number;
  let limit: number;
  let unit: IncludedUnit;
  let usedSource: string;
  let limitSource: string;

  if (useCentsPool) {
    used = includedSpendCents;
    // Team seat included pool is not always on the member row; fall back to known Pro-size $20.
    const memberIncludedLimit = toNumber(meRecord.includedRequestLimit)
      ?? toNumber(meRecord.includedSpendLimitCents);
    limit = memberIncludedLimit !== null && memberIncludedLimit > 0
      ? memberIncludedLimit
      : Math.max(includedSpendCents, 2000);
    unit = "cents";
    usedSource = "member.includedSpendCents";
    limitSource = memberIncludedLimit !== null ? "member.includedSpendLimit" : "fallback:2000c";
  } else {
    used = usageTotals && usageTotals.used > 0 ? usageTotals.used : memberUsed.value;
    limit = usageTotals && usageTotals.limit > 0 ? usageTotals.limit : memberLimit.value;
    unit = "requests";
    usedSource = usageTotals && usageTotals.used > 0
      ? `usage.${usageTotals.source}.used`
      : `member.${memberUsed.source}`;
    limitSource = usageTotals && usageTotals.limit > 0
      ? `usage.${usageTotals.source}.limit`
      : `member.${memberLimit.source}`;
  }
  log(`Team request source: used=${usedSource}, limit=${limitSource}, unit=${unit}`);

  const spendCents = toNumber(meRecord.spendCents) ?? 0;
  const spendDollars = spendCents / 100;
  const hardLimit = toNumber(meRecord.hardLimitOverrideDollars);
  const onDemandState = !setup.onDemandEnabled
    ? "disabled"
    : hardLimit !== null && hardLimit > 0
      ? "limited"
      : "unlimited";
  const limitDollars = onDemandState === "limited" ? hardLimit : null;
  log(`On-demand state: ${onDemandState}`);

  const result: UsagePayload = {
    includedRequests: {
      used,
      limit,
      unit,
    },
    onDemand: {
      state: onDemandState,
      spendDollars,
      limitDollars,
    },
    resetsAt,
  };

  const spendLimitLabel = result.onDemand.state === "unlimited"
    ? "∞"
    : result.onDemand.state === "disabled"
      ? "hidden"
      : `$${(result.onDemand.limitDollars ?? 0).toFixed(2)}`;
  log(
    `Result: ${result.includedRequests.used}/${result.includedRequests.limit} (${unit}), $${result.onDemand.spendDollars.toFixed(2)}/${spendLimitLabel}`,
  );
  return result;
}

async function fetchSoloUsage(
  auth: AuthInfo,
  headers: ReturnType<typeof cursorHeaders>,
  setup: SetupCache,
): Promise<UsagePayload | null> {
  const res = await fetch(`https://cursor.com/api/usage?user=${auth.userId}`, withTimeout({ headers }));

  if (!res.ok) {
    log(`Usage API failed: ${res.status}`);
    return null;
  }

  const usage = await res.json();
  const totals = extractUsageTotals(usage);
  const resetsAt = usage.startOfMonth ? nextMonth(usage.startOfMonth) : null;

  const result: UsagePayload = {
    includedRequests: {
      used: totals.used,
      limit: totals.limit,
      unit: "requests",
    },
    onDemand: setup.onDemandEnabled
      ? { state: "limited", spendDollars: 0, limitDollars: 0 }
      : { state: "disabled", spendDollars: 0, limitDollars: null },
    resetsAt,
  };

  log(`Result: ${result.includedRequests.used}/${result.includedRequests.limit} reqs`);
  return result;
}

function parseDailySpendRow(row: unknown): DailySpendRow | null {
  const data = asRecord(row);
  if (!data) return null;

  const day = toNumber(data.day);
  const category = typeof data.category === "string" ? data.category : null;
  const spendCents = toNumber(data.spendCents);
  const totalTokens = toNumber(data.totalTokens);

  if (day === null || !category || spendCents === null || totalTokens === null) {
    return null;
  }

  return {
    day,
    category,
    spendCents,
    totalTokens,
  };
}

async function resolveDashboardUserId(
  auth: AuthInfo,
  headers: ReturnType<typeof cursorHeaders>,
  setup: SetupCache,
): Promise<number | null> {
  const directUserId = toNumber(auth.userId);
  if (directUserId !== null) {
    return directUserId;
  }

  if (!setup.isTeamMember || !setup.teamId) {
    return null;
  }

  const res = await fetch("https://cursor.com/api/dashboard/get-team-spend", withTimeout({
    method: "POST",
    headers,
    body: JSON.stringify({ teamId: setup.teamId }),
  }));
  if (!res.ok) {
    log(`get-team-spend failed while resolving dashboard user id: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const members: unknown[] = Array.isArray(data.teamMemberSpend) ? data.teamMemberSpend : [];
  for (const member of members) {
    const record = asRecord(member);
    if (!record) continue;

    const memberEmail = typeof record.email === "string" ? record.email : null;
    const memberAuthId = typeof record.authId === "string" ? record.authId : null;
    const memberUserId = toNumber(record.userId);
    if (memberUserId === null) continue;

    if (
      (auth.email && memberEmail === auth.email) ||
      (memberAuthId && memberAuthId === auth.userId) ||
      String(record.userId) === auth.userId
    ) {
      return memberUserId;
    }
  }

  log(`Could not resolve dashboard user id from team spend (email=${auth.email}, userId=${auth.userId})`);
  return null;
}

export async function fetchDailySpendByCategory(): Promise<DailySpendRow[]> {
  log("--- Fetching daily spend by category ---");

  const auth = await getCursorToken();
  if (!auth) {
    log("Failed to get auth token for daily spend");
    return [];
  }

  const headers = cursorHeaders(auth.sessionToken);
  const setup = await ensureSetup(auth.userId, headers);
  if (!setup?.isTeamMember || !setup.teamId) {
    log("Skipping daily spend fetch: team setup unavailable");
    return [];
  }

  const dashboardUserId = await resolveDashboardUserId(auth, headers, setup);
  if (dashboardUserId === null) {
    log("Skipping daily spend fetch: dashboard user id unavailable");
    return [];
  }

  const periodEndMs = Date.now();
  const periodStartMs = periodEndMs - 31 * 86_400_000;
  const res = await fetch("https://cursor.com/api/dashboard/get-daily-spend-by-category", withTimeout({
    method: "POST",
    headers,
    body: JSON.stringify({
      teamId: setup.teamId,
      userId: dashboardUserId,
      periodStartMs,
      periodEndMs,
      groupBy: 1,
      spendType: 1,
    }),
  }));

  if (!res.ok) {
    log(`get-daily-spend-by-category failed: ${res.status}`);
    return [];
  }

  const data = await res.json();
  const rows: unknown[] = Array.isArray(data.dailySpend) ? data.dailySpend : [];
  const parsedRows: DailySpendRow[] = [];
  for (const row of rows) {
    const parsed = parseDailySpendRow(row);
    if (parsed) parsedRows.push(parsed);
  }
  log(`Fetched ${parsedRows.length} daily spend rows`);
  return parsedRows;
}

function parseEventKind(kind: string): string {
  if (kind === "USAGE_EVENT_KIND_USAGE_BASED") return "On-Demand";
  if (kind === "USAGE_EVENT_KIND_ERRORED_NOT_CHARGED") return "Errored";
  if (kind === "USAGE_EVENT_KIND_ABORTED_NOT_CHARGED") return "Aborted";
  return "Included";
}

export async function fetchUsageEvents(): Promise<UsageEvent[]> {
  log("--- Fetching usage events ---");

  const auth = await getCursorToken();
  if (!auth) {
    log("Failed to get auth token for events");
    return [];
  }

  const headers = cursorHeaders(auth.sessionToken);
  const setup = await ensureSetup(auth.userId, headers);
  const teamId = setup?.teamId ?? 0;

  const endDate = Date.now();
  const startDate = endDate - 31 * 86_400_000;
  const pageSize = 500;
  let page = 1;
  const allEvents: UsageEvent[] = [];

  while (page <= MAX_USAGE_EVENT_PAGES) {
    const res = await fetch("https://cursor.com/api/dashboard/get-filtered-usage-events", withTimeout({
      method: "POST",
      headers,
      body: JSON.stringify({
        teamId,
        startDate: String(startDate),
        endDate: String(endDate),
        page,
        pageSize,
      }),
    }));

    if (!res.ok) {
      log(`get-filtered-usage-events failed: ${res.status}`);
      break;
    }

    const data = await res.json();
    const dataRecord = asRecord(data) ?? {};
    const events: unknown[] = Array.isArray(dataRecord.usageEventsDisplay) ? dataRecord.usageEventsDisplay : [];

    if (page === 1) {
      log(`Total usage events available: ${dataRecord.totalUsageEventsCount ?? "unknown"}`);
    }

    for (const event of events) {
      const e = asRecord(event) ?? {};
      const tok = asRecord(e.tokenUsage) ?? {};
      const totalTokens =
        (toNumber(tok.inputTokens) ?? 0) +
        (toNumber(tok.outputTokens) ?? 0) +
        (toNumber(tok.cacheWriteTokens) ?? 0) +
        (toNumber(tok.cacheReadTokens) ?? 0);

      const requests = toNumber(e.requestsCosts) ?? toNumber(e.numRequests) ?? 1;
      const spendCents = toNumber(e.chargedCents) ?? 0;

      allEvents.push({
        timestamp: toNumber(e.timestamp) ?? 0,
        model: typeof e.model === "string" ? e.model : "unknown",
        kind: parseEventKind(typeof e.kind === "string" ? e.kind : ""),
        totalTokens,
        requests,
        spendCents,
        maxMode: Boolean(e.maxMode),
      });
    }

    if (events.length < pageSize) break;
    page++;
  }

  if (page > MAX_USAGE_EVENT_PAGES) {
    log(`Stopped usage events fetch after ${MAX_USAGE_EVENT_PAGES} page(s)`);
  }

  log(`Fetched ${allEvents.length} usage events across ${Math.min(page, MAX_USAGE_EVENT_PAGES)} page(s)`);
  return allEvents;
}
