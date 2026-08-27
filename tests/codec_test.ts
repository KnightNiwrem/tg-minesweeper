import { assert, assertEquals } from "@std/assert";
import {
  ACTION_RE,
  cbCell,
  cbDiff,
  cbMode,
  cbNew,
  cbQuit,
  DIFF_RE,
  parseAction,
} from "../src/codec.ts";

Deno.test("cell payload round-trips through the action regex", () => {
  const data = cbCell("ab12", 11, 7);
  assertEquals(data, "ms:ab12:c:11:7");
  const m = data.match(ACTION_RE);
  assert(m !== null);
  assertEquals(parseAction(m), { kind: "cell", nonce: "ab12", r: 11, c: 7 });
});

Deno.test("mode/new/quit payloads round-trip", () => {
  for (
    const [data, kind] of [
      [cbMode("zz9a"), "mode"],
      [cbNew("zz9a"), "new"],
      [cbQuit("zz9a"), "quit"],
    ] as const
  ) {
    const m = data.match(ACTION_RE);
    assert(m !== null, data);
    assertEquals(parseAction(m), { kind, nonce: "zz9a" });
  }
});

Deno.test("difficulty payloads match only the picker regex", () => {
  for (const d of ["easy", "medium", "hard"] as const) {
    const data = cbDiff(d);
    const m = data.match(DIFF_RE);
    assert(m !== null);
    assertEquals(m[1], d);
    assertEquals(data.match(ACTION_RE), null);
  }
  assertEquals("ms:diff:impossible".match(DIFF_RE), null);
});

Deno.test("every payload is at most 64 bytes", () => {
  const enc = new TextEncoder();
  const payloads = [
    cbCell("zzzz", 11, 11),
    cbMode("zzzz"),
    cbNew("zzzz"),
    cbQuit("zzzz"),
    cbDiff("medium"),
  ];
  for (const p of payloads) {
    assert(enc.encode(p).length <= 64, `${p} exceeds 64 bytes`);
  }
});
