/**
 * Unit tests for buildFtsExpression — the natural-text → FTS5 translation
 * that keeps user input from crashing the duties_fts MATCH operator.
 */

import { test } from "node:test";
import assert from "node:assert";
import { buildFtsExpression } from "../../api/duties-db.js";

test("simple words are joined as required terms", () => {
  assert.strictEqual(buildFtsExpression("court report"), '"court" "report"');
});

test("apostrophes inside a token stay inside the phrase quotes", () => {
  // The FTS5 expression parser breaks on a bareword apostrophe (Children's).
  // Wrapping each token in double quotes makes it a phrase literal; the
  // unicode61 tokenizer drops the apostrophe at index time, so the phrase
  // matches "Children" "s" — functionally fine. What we care about here is
  // that the result is a well-formed FTS5 expression with no unquoted
  // operators or stray characters at top level.
  const expr = buildFtsExpression("Children's Act");
  assert.ok(expr);
  assert.match(expr!, /^"[^"]+"(\s"[^"]+")*$/);
  assert.ok(expr!.includes('"Act"'));
});

test("a quoted phrase is preserved as an FTS5 phrase token", () => {
  const expr = buildFtsExpression('"local authority"');
  assert.strictEqual(expr, '"local authority"');
});

test("phrase + extra terms combine with implicit AND", () => {
  const expr = buildFtsExpression('"local authority" report duty');
  assert.strictEqual(expr, '"local authority" "report" "duty"');
});

test("section reference like s.117 doesn't break", () => {
  const expr = buildFtsExpression("s.117 hospital");
  assert.ok(expr);
  // Even if s.117 collapses to one token, the result must parse safely.
  assert.ok(/^"[^"]+"(\s"[^"]+")*$/.test(expr!), `unexpected shape: ${expr}`);
});

test("inputs with parens and stars don't crash and don't propagate operators", () => {
  const expr = buildFtsExpression("(licence OR permit) AND grant*");
  assert.ok(expr);
  // No raw parens, *, or : should leak through as FTS operators
  assert.ok(!/[()*:]/.test(expr!));
});

test("unterminated quote is tolerated", () => {
  const expr = buildFtsExpression('"unterminated phrase that runs on');
  assert.ok(expr);
  // Result should still be a valid set of phrase tokens
  assert.ok(/^"[^"]+"/.test(expr!));
});

test("only-punctuation input yields null", () => {
  assert.strictEqual(buildFtsExpression("***()"), null);
  assert.strictEqual(buildFtsExpression("   "), null);
  assert.strictEqual(buildFtsExpression(""), null);
});

test("a single dangling double-quote yields null, not a syntax error", () => {
  // The opening quote consumes the rest as a phrase, which trims to empty.
  const expr = buildFtsExpression('"');
  assert.strictEqual(expr, null);
});
