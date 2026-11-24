import { readFileSync } from "node:fs";
import type { AddressInfo, Socket } from "node:net";
import { Readable } from "node:stream";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Seed } from "./fixtures/seeds";
import { applyPost, bootSim, listState, simFromState } from "./wledSim.ts";

/**
 * A fake WLED device for tests: a Fastify server on 127.0.0.1 that serves the
 * WLED endpoints the app uses from a seed, applies state writes through the
 * segment simulator and config writes with the firmware's rules, and can be
 * told to fail like a real device.
 */

export type FakeMode = "ok" | "timeout" | "busy" | "reset" | "deviceError" | "notJson" | "serverError" | "huge";

export type FakeOpts = {
  pin?: string;
  version?: "0.15" | "17";
  nodes?: { ip: string }[];
  /** The body of `/settings/s.js?p=2`. Defaults to the fixture for `version`. */
  sjs?: string;
  /** How many `/json/net` calls return `[]` before the scan results. */
  scanEmptyCalls?: number;
  /** Merged over `/json/info`. A key set to `undefined` is left out of the reply. */
  infoOverride?: object;
  /** Listen on this port instead of a free one. */
  port?: number;
  /** The largest POST body in bytes; a larger one gets 400 (`JSON_BUFFER_SIZE`, 10240 on ESP8266). */
  maxBody?: number;
};

export type FakeWled = {
  port: number;
  requests: { method: string; path: string; body: unknown }[];
  setMode(m: FakeMode): void;
  failNext(m: FakeMode, match: { method?: string; path?: string; skip?: number }): void;
  /** Holds the next matching request before it is handled, until the returned function is called. */
  hold(match: { method?: string; path?: string }): () => void;
  /** Reboots: the uptime restarts and the segments boot from `cfg.def` and the boot preset. */
  restart(): void;
  cfg: Record<string, unknown>;
  /** The state `GET /json/state` returns, as a snapshot. */
  readonly state: ReturnType<typeof listState>;
  /** Applies a state change made by another client. */
  applyState(body: Record<string, unknown>): void;
  /** Runs `fn` once, after the next `POST /json/state` is applied and before it is answered. */
  afterPost(fn: () => void): void;
  close(): Promise<void>;
};

type Json = Record<string, unknown>;

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => structuredClone(v);

// "huge" streams a 2 MB reply that is valid JSON, so only a size limit rejects it.
const HUGE_CHUNK = Buffer.alloc(64 * 1024, "a");
const hugeReply = (): Readable =>
  Readable.from([Buffer.from('{"pad":"'), ...Array.from({ length: 32 }, () => HUGE_CHUNK), Buffer.from('"}')]);

export async function startFakeWled(seed: Seed, opts: FakeOpts = {}): Promise<FakeWled> {
  const version = opts.version ?? "17";
  const sjs = opts.sjs ?? fixture(version === "0.15" ? "sjsV015.txt" : "sjsV17.txt");
  const scanEmptyCalls = opts.scanEmptyCalls ?? 2;

  const cfg = clone(seed.cfg) as unknown as Json;
  const def = cfg.def as { on: boolean; bri: number; ps: number };
  const sim = simFromState(seed.state as Parameters<typeof simFromState>[0], seed.info.leds.maxseg, seed.info.leds.count);
  sim.presets = clone(seed.presets);
  const maxBody = opts.maxBody ?? 10240;
  let afterPostFns: (() => void)[] = [];
  const requests: FakeWled["requests"] = [];
  let mode: FakeMode = "ok";
  const pending: { mode: FakeMode; method?: string; path?: string; skip: number }[] = [];
  const holds: { method?: string; path?: string; released: Promise<void> }[] = [];
  let unlocked = false;
  let netCalls = 0;
  let bootAt = Date.now();
  let uptimeAtBoot = seed.info.uptime;

  const locked = (): boolean => opts.pin !== undefined && !unlocked;

  const info = (): Json => ({
    ...clone(seed.info),
    name: isObject(cfg.id) && typeof cfg.id.name === "string" ? cfg.id.name : seed.info.name,
    uptime: uptimeAtBoot + Math.floor((Date.now() - bootAt) / 1000),
    ...opts.infoOverride,
  });

  // `cfg.def.ps` is the boot preset; a psave with bootps changes it (presets.cpp:238-243).
  const applyState = (body: Json): void => {
    sim.bootps = def.ps;
    applyPost(sim, body);
    def.ps = sim.bootps;
  };

  const restart = (): void => {
    bootAt = Date.now();
    uptimeAtBoot = 0;
    sim.bootps = def.ps;
    bootSim(sim, def);
  };

  // The firmware checks a top-level "pin" in any JSON POST before it applies the body.
  const checkPin = (body: Json): void => {
    if (opts.pin !== undefined && body.pin !== undefined) unlocked = String(body.pin) === opts.pin;
  };

  const modeFor = (request: FastifyRequest): FakeMode => {
    const pathname = request.url.split("?")[0];
    const matches = pending.filter(
      (p) => (!p.method || p.method === request.method) && (!p.path || p.path === request.url || p.path === pathname),
    );
    // The first match with no skips left fires; every other match counts this request as one skip.
    const fire = matches.find((p) => p.skip === 0);
    matches.forEach((p) => {
      if (p !== fire) p.skip -= 1;
    });
    if (!fire) return mode;
    pending.splice(pending.indexOf(fire), 1);
    return fire.mode;
  };

  const app = Fastify({ logger: false, forceCloseConnections: true });
  // The firmware answers a body over its JSON buffer with 400 and applies nothing.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    if (Buffer.byteLength(body as string) > maxBody) {
      done(Object.assign(new Error("body too large"), { statusCode: 400 }), undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(Object.assign(err as Error, { statusCode: 400 }), undefined);
    }
  });
  app.setErrorHandler((err: { statusCode?: number }, _request, reply) => {
    if (err.statusCode === 400) return reply.code(400).send({ error: 9 });
    return reply.code(err.statusCode ?? 500).send("");
  });
  const sockets = new Set<Socket>();
  app.server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  // Recorded in onRequest so that unrouted paths are recorded too; the body is filled in once parsed.
  const recorded = new WeakMap<FastifyRequest, FakeWled["requests"][number]>();
  app.addHook("onRequest", async (request) => {
    const entry = { method: request.method, path: request.url, body: undefined as unknown };
    requests.push(entry);
    recorded.set(request, entry);
  });

  app.addHook("preHandler", async (request, reply) => {
    const entry = recorded.get(request);
    if (entry) entry.body = request.body;
    const pathname = request.url.split("?")[0];
    const held = holds.find((h) => (!h.method || h.method === request.method) && (!h.path || h.path === request.url || h.path === pathname));
    if (held) {
      holds.splice(holds.indexOf(held), 1);
      await held.released;
    }
    switch (modeFor(request)) {
      case "ok":
        return;
      case "timeout":
        await new Promise(() => {});
        return;
      case "busy":
        return reply.code(503).send("");
      case "reset":
        reply.hijack();
        request.raw.socket.destroy();
        return reply;
      case "deviceError":
        return reply.code(200).send({ error: 3 });
      case "notJson":
        return reply.code(200).type("text/html").send("<html><body>Not found</body></html>");
      case "serverError":
        return reply.code(500).send("");
      case "huge":
        return reply
        .code(200)
        .type("application/json")
        .send(hugeReply());
    }
  });

  const state = () => listState(sim);
  const full = (): Json => ({ state: state(), info: info(), effects: seed.effects, palettes: seed.palettes });

  app.get("/json", async () => full());
  app.get("/json/state", async () => state());
  app.get("/json/info", async () => info());
  app.get("/json/si", async () => ({ state: state(), info: info() }));
  app.get("/json/effects", async () => seed.effects);
  app.get("/json/fxdata", async () => seed.fxdata);
  app.get("/json/palettes", async () => seed.palettes);
  app.get("/json/pal", async () => seed.palettes);
  app.get<{ Querystring: { page?: string } }>("/json/palx", async (request) => palx(seed, Number(request.query.page) || 0));
  app.get("/json/cfg", async () => cfg);
  app.get("/json/nodes", async () => ({
    nodes: (opts.nodes ?? []).map((n, i) => ({ name: `WLED ${i + 1}`, type: 32, ip: n.ip, age: 0, vid: seed.info.vid })),
  }));
  app.get("/json/net", async () => {
    netCalls += 1;
    if (netCalls <= scanEmptyCalls) return { networks: [] };
    return {
      networks: seed.networks.map((n, i) => ({ ...n, bssid: `AA:BB:CC:00:00:${String(i).padStart(2, "0")}` })),
    };
  });
  // /json/pins does not exist in 0.15: the path falls through to the full /json reply.
  app.get("/json/pins", async () => (version === "0.15" ? full() : { pins: seed.pins }));
  app.get("/json/*", async (_request, reply) => reply.code(501).send({ error: 4 }));
  app.get("/presets.json", async () => sim.presets);

  app.get<{ Querystring: { p?: string } }>("/settings/s.js", async (request, reply) => {
    const page = Number(request.query.p ?? 0);
    if (page > 0 && locked()) return reply.code(401).type("text/plain").send("");
    reply.type("application/javascript");
    return page === 2 ? sjs : "function GetV(){var d=document;}";
  });

  const postState = async (request: FastifyRequest, reply: FastifyReply, view: () => unknown) => {
    const body = isObject(request.body) ? request.body : {};
    checkPin(body);
    applyState(clone(body));
    if (request.url.split("?")[0] === "/json/state") {
      const fns = afterPostFns;
      afterPostFns = [];
      fns.forEach((fn) => fn());
    }
    const answer = body.v === true ? view() : { success: true };
    // json.cpp:440: "rb" reboots after the reply, and not in a psave request.
    if (body.rb === true && body.psave === undefined) restart();
    return reply.send(answer);
  };
  app.post("/json", (request, reply) => postState(request, reply, full));
  app.post("/json/state", (request, reply) => postState(request, reply, state));
  app.post("/json/si", (request, reply) => postState(request, reply, () => ({ state: state(), info: info() })));

  app.post("/json/cfg", async (request, reply) => {
    const body = isObject(request.body) ? request.body : {};
    checkPin(body);
    if (locked()) return reply.code(401).send({ error: 1 });
    for (const [key, value] of Object.entries(body)) {
      if (key === "pin") continue;
      if (key === "nw" && isObject(value)) cfg.nw = mergeNetwork(cfg.nw as Json, value);
      else if (key === "ap" && isObject(value)) cfg.ap = mergeAp(cfg.ap as Json, value);
      else cfg[key] = deepMerge(cfg[key], value);
    }
    return { success: true };
  });

  await app.listen({ host: "127.0.0.1", port: opts.port ?? 0 });
  const port = (app.server.address() as AddressInfo).port;

  let closing: Promise<void> | undefined;
  return {
    port,
    requests,
    setMode(m) {
      mode = m;
    },
    failNext(m, match) {
      pending.push({ mode: m, method: match.method, path: match.path, skip: match.skip ?? 0 });
    },
    hold(match) {
      let release = (): void => {};
      holds.push({ ...match, released: new Promise<void>((resolve) => (release = resolve)) });
      return () => release();
    },
    restart,
    cfg,
    get state() {
      return state();
    },
    applyState,
    afterPost(fn) {
      afterPostFns.push(fn);
    },
    close() {
      closing ??= (async () => {
        sockets.forEach((s) => s.destroy());
        await app.close();
      })();
      return closing;
    },
  };
}

/** cfg.cpp keeps every key a write leaves out: objects merge at every depth, anything else (arrays too) replaces. */
function deepMerge(current: unknown, next: unknown): unknown {
  if (!isObject(current) || !isObject(next)) return clone(next);
  const out: Json = { ...clone(current) };
  for (const [key, value] of Object.entries(next)) out[key] = deepMerge(current[key], value);
  return out;
}

/** Strips `psk` from a Wi-Fi entry and keeps its length, as the firmware does. */
function withPskLength(entry: Json, psk: unknown, fallback: unknown): Json {
  const { psk: _psk, ...rest } = entry;
  return { ...rest, pskl: typeof psk === "string" ? psk.length : (fallback ?? 0) };
}

// cfg.cpp: `nw.ins` grows but never shrinks; an empty ssid or an empty client psk is ignored.
function mergeNetwork(current: Json, next: Json): Json {
  const ins = ((current.ins as Json[] | undefined) ?? []).map((e) => clone(e));
  ((next.ins as unknown[] | undefined) ?? []).forEach((raw, i) => {
    if (!isObject(raw)) return;
    const prev = ins[i] ?? {};
    const { ssid, psk, pskl: _pskl, ...rest } = clone(raw);
    const merged: Json = { ...prev, ...rest };
    if (typeof ssid === "string" && ssid !== "") merged.ssid = ssid;
    ins[i] = withPskLength(merged, typeof psk === "string" && psk !== "" ? psk : undefined, prev.pskl);
  });
  const { ins: _ins, ...rest } = next;
  return { ...(deepMerge(current, rest) as Json), ins };
}

// cfg.cpp: `ap.psk` is copied with no check, so "" makes the access point open.
function mergeAp(current: Json, next: Json): Json {
  const { pskl: _pskl, psk, ...rest } = next;
  return withPskLength(deepMerge(current, rest) as Json, psk, current.pskl);
}

// Two colors per palette for `/json/palx`; palette k uses entries k and k + 1.
const PALX_COLORS = [
  [255, 0, 0],
  [255, 160, 0],
  [255, 255, 0],
  [0, 200, 80],
  [0, 80, 255],
  [128, 0, 255],
  [255, 255, 255],
];

/** `serializePalettes` (json.cpp:983-1058): 8 palettes a page (5 on ESP8266); palettes 1-5 are color references. */
function palx(seed: Seed, requested: number): Json {
  const perPage = seed.info.arch === "esp8266" ? 5 : 8;
  const count = seed.palettes.length;
  const maxPage = Math.floor(count / perPage);
  const page = Math.min(Math.max(0, requested), maxPage);
  const refs: Record<number, string[]> = {
    1: ["r", "r", "r", "r"],
    2: ["c1"],
    3: ["c1", "c1", "c2", "c2"],
    4: ["c3", "c2", "c1"],
    5: [...Array<string>(5).fill("c1"), ...Array<string>(5).fill("c2"), ...Array<string>(5).fill("c3"), "c1"],
  };
  const p: Json = {};
  for (let id = page * perPage; id < Math.min(count, (page + 1) * perPage); id++) {
    const a = PALX_COLORS[id % PALX_COLORS.length]!;
    const b = PALX_COLORS[(id + 1) % PALX_COLORS.length]!;
    p[String(id)] = refs[id] ?? [
      [0, ...a],
      [255, ...b],
    ];
  }
  return { m: maxPage, p };
}
