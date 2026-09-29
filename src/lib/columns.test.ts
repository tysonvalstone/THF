import { test } from "node:test";
import assert from "node:assert/strict";

import { activeColumns, buildCsv, defaultSetup, formatValue, normalizeSetup, previewTable, type ColumnDef } from "./columns";

interface Row {
  id: string;
  name: string;
  amount: number;
  rate: number;
  close: string;
  active: boolean;
  tags: string[];
}

const defs: ColumnDef<Row>[] = [
  { key: "id", label: "Id", value: (r) => r.id, required: true },
  { key: "name", label: "Name", value: (r) => r.name },
  { key: "amount", label: "Amount", type: "currency", value: (r) => r.amount },
  { key: "rate", label: "Rate", type: "percent", value: (r) => r.rate },
  { key: "close", label: "Close", type: "date", value: (r) => r.close },
  { key: "active", label: "Active", type: "boolean", value: (r) => r.active, defaultOn: false },
  { key: "tags", label: "Tags", value: (r) => r.tags },
];

const rows: Row[] = [
  { id: "001", name: 'Big "Co", Inc', amount: 1234.567, rate: 0.4567, close: "2026-03-09", active: true, tags: ["Corn", "Soy"] },
  { id: "002", name: "Line\nbreak", amount: 10, rate: 0.1, close: "2026-12-31T00:00:00.000Z", active: false, tags: [] },
];

test("defaultSetup honours defaultOn and required", () => {
  const s = defaultSetup(defs);
  assert.deepEqual(
    s.columns.map((c) => [c.key, c.on]),
    [["id", true], ["name", true], ["amount", true], ["rate", true], ["close", true], ["active", false], ["tags", true]],
  );
  assert.equal(s.dateFormat, "iso");
});

test("normalizeSetup keeps order, drops unknown, appends new, forces required", () => {
  const s = normalizeSetup(defs, {
    columns: [
      { key: "rate", on: true, label: "Win %" },
      { key: "gone", on: true },
      { key: "id", on: false, label: "Record" },
      { key: "name", on: false },
      { key: "rate", on: false },
    ],
    dateFormat: "us",
    scope: "all",
  });
  assert.deepEqual(
    s.columns.map((c) => c.key),
    ["rate", "id", "name", "amount", "close", "active", "tags"],
  );
  assert.deepEqual(s.columns[1], { key: "id", on: true });
  assert.equal(s.columns[0].label, "Win %");
  assert.equal(s.columns[2].on, false);
  assert.equal(s.columns[5].on, false);
  assert.equal(s.dateFormat, "us");
  assert.equal(s.scope, "all");
  // Invalid values fall back to defaults
  const bad = normalizeSetup(defs, { columns: [], dateFormat: "xx" as never, scope: "nope" as never });
  assert.equal(bad.dateFormat, "iso");
  assert.equal(bad.scope, "filtered");
  assert.equal(normalizeSetup(defs, null).columns.length, defs.length);
});

test("activeColumns applies labels and ignores labels on required columns", () => {
  const cols = activeColumns(defs, { columns: [{ key: "name", on: true, label: "  Company " }, { key: "id", on: true, label: "X" }], dateFormat: "iso", scope: "all" });
  assert.deepEqual(
    cols.map((c) => c.header),
    ["Company", "Id", "Amount", "Rate", "Close", "Tags"],
  );
});

test("formatValue by type", () => {
  assert.equal(formatValue(0.4567, "percent"), "45.7");
  assert.equal(formatValue(1234.567, "currency"), "1234.57");
  assert.equal(formatValue(3.14159, "number"), "3.14");
  assert.equal(formatValue(true, "boolean"), "true");
  assert.equal(formatValue(0, "boolean"), "false");
  assert.equal(formatValue(false), "false");
  assert.equal(formatValue(["a", "b"]), "a;b");
  assert.equal(formatValue(null), "");
  assert.equal(formatValue(undefined, "number"), "");
  assert.equal(formatValue(Number.NaN, "number"), "");
  assert.equal(formatValue("2026-03-09", "date", "iso"), "2026-03-09");
  assert.equal(formatValue("2026-03-09", "date", "us"), "03/09/2026");
  assert.equal(formatValue("2026-03-09T12:00:00Z", "date", "eu"), "09/03/2026");
  assert.equal(formatValue(new Date(Date.UTC(2026, 0, 5)), "date", "us"), "01/05/2026");
  assert.equal(formatValue("", "date"), "");
  assert.equal(formatValue("soon", "date"), "soon");
});

test("buildCsv quotes per RFC 4180 and uses CRLF", () => {
  const csv = buildCsv(rows, defs, {
    columns: [
      { key: "name", on: true, label: "Account, name" },
      { key: "id", on: true },
      { key: "amount", on: false },
      { key: "rate", on: true },
      { key: "close", on: true },
      { key: "active", on: true },
      { key: "tags", on: true },
    ],
    dateFormat: "us",
    scope: "all",
  });
  const lines = csv.split("\r\n");
  assert.equal(lines[0], '"Account, name",Id,Rate,Close,Active,Tags');
  assert.equal(lines[1], '"Big ""Co"", Inc",001,45.7,03/09/2026,true,Corn;Soy');
  assert.equal(lines[2], '"Line\nbreak",002,10,12/31/2026,false,');
  assert.equal(lines.length, 3);
});

test("previewTable returns the first n rows", () => {
  const p = previewTable(rows, defs, defaultSetup(defs), 1);
  assert.deepEqual(p.headers, ["Id", "Name", "Amount", "Rate", "Close", "Tags"]);
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.rows[0], ["001", 'Big "Co", Inc', "1234.57", "45.7", "2026-03-09", "Corn;Soy"]);
});
