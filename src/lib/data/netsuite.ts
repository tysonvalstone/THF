import "server-only";

/**
 * Read-only NetSuite connection: customer invoices and payments via SuiteQL
 * (REST query service) with Token-Based Authentication (OAuth 1.0a,
 * HMAC-SHA256). Only SELECT statements are ever sent; nothing is written.
 *
 * Enabled when all five env vars are set:
 *   NS_ACCOUNT_ID (e.g. 1234567 or 1234567_SB1), NS_CONSUMER_KEY,
 *   NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET
 */
import { createHmac, randomBytes } from "node:crypto";
import type { Invoice, Payment } from "@/types/salesforce";

export interface NetSuiteInvoice extends Invoice {
  /** NetSuite customer name (the app matches it to an account by name) */
  CustomerName: string;
}
export interface NetSuitePayment extends Payment {
  CustomerName: string;
}

export interface NetSuiteResult {
  mode: "live" | "off";
  invoices: NetSuiteInvoice[];
  payments: NetSuitePayment[];
  /** Set when configured but the read failed */
  error?: string;
  loadedAt?: string;
}

interface Config {
  account: string;
  consumerKey: string;
  consumerSecret: string;
  tokenId: string;
  tokenSecret: string;
}

function config(): Config | null {
  const c = {
    account: process.env.NS_ACCOUNT_ID?.trim() ?? "",
    consumerKey: process.env.NS_CONSUMER_KEY?.trim() ?? "",
    consumerSecret: process.env.NS_CONSUMER_SECRET?.trim() ?? "",
    tokenId: process.env.NS_TOKEN_ID?.trim() ?? "",
    tokenSecret: process.env.NS_TOKEN_SECRET?.trim() ?? "",
  };
  return Object.values(c).every(Boolean) ? c : null;
}

export const netsuiteConfigured = () => config() !== null;

/** RFC 3986 percent-encoding (OAuth 1.0a) */
export function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * OAuth 1.0a Authorization header (HMAC-SHA256) for a NetSuite REST call.
 * Query parameters are part of the signature base string.
 */
export function oauthHeader(
  c: Config,
  method: string,
  url: string,
  opts: { nonce?: string; timestamp?: number } = {},
): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: c.consumerKey,
    oauth_nonce: opts.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(opts.timestamp ?? Math.floor(Date.now() / 1000)),
    oauth_token: c.tokenId,
    oauth_version: "1.0",
  };
  const params: [string, string][] = [...Object.entries(oauth), ...[...u.searchParams.entries()]].map(([k, v]) => [pct(k), pct(v)]);
  params.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), pct(`${u.origin}${u.pathname}`), pct(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const key = `${pct(c.consumerSecret)}&${pct(c.tokenSecret)}`;
  const signature = createHmac("sha256", key).update(base).digest("base64");
  const realm = c.account.toUpperCase().replace(/-/g, "_");
  const fields = { ...oauth, oauth_signature: signature };
  return `OAuth realm="${realm}", ${Object.entries(fields)
    .map(([k, v]) => `${k}="${pct(v)}"`)
    .join(", ")}`;
}

/** Account-specific REST host: 1234567_SB1 → 1234567-sb1.suitetalk.api.netsuite.com */
export const hostFor = (account: string) => `https://${account.toLowerCase().replace(/_/g, "-")}.suitetalk.api.netsuite.com`;

/** Runs a read-only SuiteQL query, following pages up to `maxRows` */
async function suiteql<T>(c: Config, q: string, maxRows = 5000): Promise<T[]> {
  if (!/^\s*select\b/i.test(q)) throw new Error("Only SELECT queries are allowed");
  const out: T[] = [];
  for (let offset = 0; offset < maxRows; offset += 1000) {
    const url = `${hostFor(c.account)}/services/rest/query/v1/suiteql?limit=1000&offset=${offset}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: oauthHeader(c, "POST", url), "Content-Type": "application/json", Prefer: "transient" },
      body: JSON.stringify({ q }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`NetSuite ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { items?: T[]; hasMore?: boolean };
    out.push(...(json.items ?? []));
    if (!json.hasMore) break;
  }
  return out;
}

type Row = Record<string, string | number | null | undefined>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (v === null || v === undefined || v === "" ? 0 : Number(v));

const INVOICE_SQL = `
SELECT t.id, t.tranid, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate, TO_CHAR(t.duedate, 'YYYY-MM-DD') AS duedate,
  TO_CHAR(t.startdate, 'YYYY-MM-DD') AS startdate, TO_CHAR(t.enddate, 'YYYY-MM-DD') AS enddate,
  t.status, BUILTIN.DF(t.status) AS statusname, t.entity, BUILTIN.DF(t.entity) AS customer,
  t.foreigntotal, t.foreignamountremaining, BUILTIN.DF(t.currency) AS currency, BUILTIN.DF(t.terms) AS terms
FROM transaction t
WHERE t.type = 'CustInvc' AND t.trandate >= ADD_MONTHS(SYSDATE, -24)
ORDER BY t.trandate DESC`;

const PAYMENT_SQL = `
SELECT l.nextdoc AS paymentid, l.previousdoc AS invoiceid, l.foreignamount AS amount,
  TO_CHAR(p.trandate, 'YYYY-MM-DD') AS paydate, p.tranid, p.entity, BUILTIN.DF(p.entity) AS customer
FROM NextTransactionLineLink l
JOIN transaction p ON p.id = l.nextdoc
WHERE p.type = 'CustPymt' AND p.trandate >= ADD_MONTHS(SYSDATE, -24)`;

export function mapInvoice(r: Row, today: string): NetSuiteInvoice {
  const total = num(r.foreigntotal);
  const remaining = num(r.foreignamountremaining);
  const statusName = `${str(r.status)} ${str(r.statusname)}`;
  const voided = /void/i.test(statusName) || str(r.status) === "V";
  const due = str(r.duedate) || str(r.trandate);
  const status: Invoice["Status"] = voided ? "Void" : remaining <= 0.005 ? "Paid" : due < today ? "Overdue" : "Sent";
  const ccy = str(r.currency).toUpperCase().includes("CA") ? "CAD" : "USD";
  return {
    Id: `ns-inv-${str(r.id)}`,
    InvoiceNumber: str(r.tranid) || `NS-${str(r.id)}`,
    ContractId: "",
    AccountId: `ns-cust-${str(r.entity)}`,
    CustomerName: str(r.customer),
    Status: status,
    IssueDate: str(r.trandate),
    DueDate: due,
    PeriodStart: str(r.startdate) || str(r.trandate),
    PeriodEnd: str(r.enddate) || str(r.trandate),
    Recurring: total,
    OneTime: 0,
    Tax: 0,
    Total: total,
    AmountPaid: Math.max(0, Math.round((total - remaining) * 100) / 100),
    HarvestTerms: /harvest/i.test(str(r.terms)),
    RemindersSent: 0,
    CurrencyIsoCode: ccy,
    External: true,
  };
}

export function mapPayment(r: Row): NetSuitePayment {
  return {
    Id: `ns-pay-${str(r.paymentid)}-${str(r.invoiceid)}`,
    InvoiceId: `ns-inv-${str(r.invoiceid)}`,
    AccountId: `ns-cust-${str(r.entity)}`,
    CustomerName: str(r.customer),
    Amount: Math.abs(num(r.amount)),
    PaymentDate: str(r.paydate),
    Method: "ACH",
    Reference: str(r.tranid),
  };
}

let cache: { at: number; result: NetSuiteResult } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** Invoices and payments from NetSuite (cached 10 minutes); mode "off" when not configured */
export async function loadNetSuite(opts: { refresh?: boolean } = {}): Promise<NetSuiteResult> {
  const c = config();
  if (!c) return { mode: "off", invoices: [], payments: [] };
  if (!opts.refresh && cache && Date.now() - cache.at < TTL_MS) return cache.result;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [inv, pay] = await Promise.all([suiteql<Row>(c, INVOICE_SQL), suiteql<Row>(c, PAYMENT_SQL)]);
    const invoices = inv.map((r) => mapInvoice(r, today));
    const ids = new Set(invoices.map((i) => i.Id));
    const payments = pay.map(mapPayment).filter((p) => ids.has(p.InvoiceId));
    const result: NetSuiteResult = { mode: "live", invoices, payments, loadedAt: new Date().toISOString() };
    cache = { at: Date.now(), result };
    return result;
  } catch (e) {
    return { mode: "off", invoices: [], payments: [], error: e instanceof Error ? e.message : String(e) };
  }
}
