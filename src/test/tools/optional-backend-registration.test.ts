/**
 * Optional backends gate tool registration.
 *
 * The semantic, Research API and duties tools are only advertised when their
 * backend env vars are set; otherwise a client sees tools it can never use,
 * which cost context in every session and get selected in error (reported by an
 * installer running against neither the Research API nor Lex).
 *
 * These drive a real Client over an in-memory transport rather than calling
 * getToolNames() directly, so they cover the request handlers a client actually
 * reaches — a test of the helper alone would still pass if the ListTools or
 * CallTool wiring were broken.
 *
 * server.js reads process.env at module load, so each configuration needs its
 * own module instance. A distinct query string on the specifier defeats the ESM
 * module cache; the specifier is built at runtime so TypeScript treats the
 * import as dynamic rather than trying to resolve the query string.
 */

import { test } from "node:test";
import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const CORE = [
  "search_legislation",
  "get_legislation_metadata",
  "get_legislation",
  "get_legislation_fragment",
  "get_legislation_table_of_contents",
  "search_effects",
  "get_resource",
];
const SEMANTIC = ["search_legislation_semantic", "search_legislation_sections_semantic"];
const RESEARCH = ["search_legislation_advanced", "count_legislation_advanced"];
const DUTIES = ["search_powers_and_duties", "count_powers_and_duties", "get_powers_and_duties"];

/** Every tool, in the order buildToolList() advertises them. */
const ALL_FOURTEEN = [
  "search_legislation",
  "get_legislation_metadata",
  "get_legislation",
  "get_legislation_fragment",
  "get_legislation_table_of_contents",
  "search_legislation_semantic",
  "search_legislation_sections_semantic",
  "search_effects",
  "search_legislation_advanced",
  "count_legislation_advanced",
  "search_powers_and_duties",
  "count_powers_and_duties",
  "get_powers_and_duties",
  "get_resource",
];

const BACKEND_VARS = [
  "SEMANTIC_API_BASE_URL",
  "RESEARCH_API_USERNAME",
  "RESEARCH_API_PASSWORD",
  "DUTIES_DB_CLUSTER_ARN",
  "DUTIES_DB_SECRET_ARN",
];

/** Fake backend configuration. Registration only checks that the vars exist, so
 *  nothing here is dialled: the ARNs never reach AWS unless a duties tool is
 *  actually called, which these tests only do on the disabled path. */
const SEMANTIC_ENV = { SEMANTIC_API_BASE_URL: "http://localhost:8000" };
const RESEARCH_ENV = { RESEARCH_API_USERNAME: "u", RESEARCH_API_PASSWORD: "p" };
const DUTIES_ENV = {
  DUTIES_DB_CLUSTER_ARN: "arn:aws:rds:eu-west-2:000000000000:cluster:test",
  DUTIES_DB_SECRET_ARN: "arn:aws:secretsmanager:eu-west-2:000000000000:secret:test",
};

/** Distinguishes module instances. Generated, never supplied: a reused tag would
 *  return the instance cached under a different configuration and the
 *  assertions would silently run against the wrong server. */
let moduleSeq = 0;

/** Connects a client to a server built with exactly `env` set for the backends. */
async function connect(env: Record<string, string>): Promise<Client> {
  const saved = new Map(BACKEND_VARS.map((k) => [k, process.env[k]]));
  for (const key of BACKEND_VARS) delete process.env[key];
  Object.assign(process.env, env);
  let server;
  try {
    const specifier = ["../../server.js", `?config=${++moduleSeq}`].join("");
    const mod = await import(specifier);
    server = mod.createServer();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "registration-test", version: "0.0.0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function toolNames(env: Record<string, string>): Promise<string[]> {
  const client = await connect(env);
  try {
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  } finally {
    await client.close();
  }
}

/** The advertised description of one tool, for a server built with `env`. */
async function describeTool(env: Record<string, string>, tool: string): Promise<string> {
  const client = await connect(env);
  try {
    const { tools } = await client.listTools();
    const found = tools.find((t) => t.name === tool);
    assert.ok(found, `${tool} should be advertised`);
    return found.description ?? "";
  } finally {
    await client.close();
  }
}

/**
 * search_legislation is always registered, so its description must not
 * recommend search_legislation_advanced on a server that does not offer it —
 * an unusable recommendation is the same defect as an unusable tool.
 */
test("search_legislation recommends the advanced tool only when the Research API is configured", async () => {
  const without = await describeTool({}, "search_legislation");
  assert.ok(
    !without.includes("search_legislation_advanced"),
    "must not recommend a tool this server does not advertise"
  );

  const with_ = await describeTool(RESEARCH_ENV, "search_legislation");
  assert.ok(
    with_.includes("search_legislation_advanced"),
    "should recommend the advanced tool once the Research API is configured"
  );
});

test("with no optional backends, only the core tools are advertised", async () => {
  const names = await toolNames({});
  assert.deepStrictEqual(names, CORE);
});

test("with every backend configured, all fourteen tools are advertised in order", async () => {
  const names = await toolNames({ ...SEMANTIC_ENV, ...RESEARCH_ENV, ...DUTIES_ENV });
  assert.deepStrictEqual(names, ALL_FOURTEEN);
});

test("semantic tools are advertised when SEMANTIC_API_BASE_URL is set", async () => {
  const names = await toolNames(SEMANTIC_ENV);
  for (const name of SEMANTIC) assert.ok(names.includes(name), `${name} should be advertised`);
  for (const name of [...RESEARCH, ...DUTIES]) {
    assert.ok(!names.includes(name), `${name} should not be advertised`);
  }
});

test("advanced tools need both Research API credentials, not just one", async () => {
  const partial = await toolNames({ RESEARCH_API_USERNAME: "u" });
  for (const name of RESEARCH) {
    assert.ok(!partial.includes(name), `${name} should not be advertised`);
  }

  const full = await toolNames(RESEARCH_ENV);
  for (const name of RESEARCH) assert.ok(full.includes(name), `${name} should be advertised`);
});

test("duties tools need both the cluster ARN and the secret ARN", async () => {
  const partial = await toolNames({ DUTIES_DB_CLUSTER_ARN: DUTIES_ENV.DUTIES_DB_CLUSTER_ARN });
  for (const name of DUTIES) assert.ok(!partial.includes(name), `${name} should not be advertised`);

  const full = await toolNames(DUTIES_ENV);
  for (const name of DUTIES) assert.ok(full.includes(name), `${name} should be advertised`);
});

/**
 * A client working from a cached tool list can still call a tool this server no
 * longer advertises. The dispatch guard has to catch that before the tool
 * reaches a null backend, and say which configuration is missing.
 */
for (const { tool, expected } of [
  ...SEMANTIC.map((tool) => ({ tool, expected: "SEMANTIC_API_BASE_URL" })),
  ...RESEARCH.map((tool) => ({ tool, expected: "RESEARCH_API_USERNAME" })),
  ...DUTIES.map((tool) => ({ tool, expected: "DUTIES_DB_CLUSTER_ARN" })),
]) {
  test(`calling de-registered ${tool} reports the missing configuration`, async () => {
    const client = await connect({});
    try {
      const result: any = await client.callTool({ name: tool, arguments: {} });
      assert.strictEqual(result.isError, true, "expected an error result");
      const text = String(result.content?.[0]?.text ?? "");
      assert.ok(
        text.includes(expected),
        `expected the error to name ${expected}, got: ${text}`
      );
      assert.ok(
        text.includes("not configured"),
        `expected a configuration error, got: ${text}`
      );
    } finally {
      await client.close();
    }
  });
}
