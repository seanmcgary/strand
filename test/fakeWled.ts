import { readFileSync } from "node:fs";
import type { AddressInfo, Socket } from "node:net";
import { Readable } from "node:stream";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { Seed } from "./fixtures/seeds";

/**
 * A fake WLED device for tests: a Fastify server on 127.0.0.1 that serves the
 * WLED endpoints the app uses from a seed, applies config writes with the
 * firmware's rules, and can be told to fail like a real device.
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
};

export type FakeWled = {
  port: number;
  requests: { method: string; path: string; body: unknown }[];
  setMode(m: FakeMode): void;
  failNext(m: FakeMode, match: { method?: string; path?: string; skip?: number }): void;
  restart(): void;
  cfg: Record<string, unknown>;
  state: Record<string, unknown>;
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
  const state: Json = clone(seed.state);
  const requests: FakeWled["requests"] = [];
  let mode: FakeMode = "ok";
  const pending: { mode: FakeMode; method?: string; path?: string; skip: number }[] = [];
  let unlocked = false;
  let netCalls = 0;
  let bootAt = Date.now();
  let uptimeAtBoot = seed.info.uptime;

  const locked = (): boolean => opts.pin !== undefined && !unlocked;

  const info = (): Json => ({
    ...clone(seed.info),
    name: (cfg.id as Json).name,
    uptime: uptimeAtBoot + Math.floor((Date.now() - bootAt) / 1000),
    ...opts.infoOverride,
  });

  const restart = (): void => {
    bootAt = Date.now();
    uptimeAtBoot = 0;
  };

  // The firmware checks a top-level "pin" in any JSON POST before it applies the body.
  const checkPin = (body: Json): void => {
    if (opts.pin !== undefined && body.pin !== undefined) unlocked = String(body.pin) === opts.pin;
  };

  const modeFor = (request: FastifyRequest): FakeMode => {
    const pathname = request.url.split("?")[0];
    const i = pending.findIndex(
      (p) => (!p.method || p.method === request.method) && (!p.path || p.path === request.url || p.path === pathname),
    );
    const match = pending[i];
    if (!match) return mode;
    if (match.skip > 0) {
      match.skip -= 1;
      return mode;
    }
    pending.splice(i, 1);
    return match.mode;
  };

  const app = Fastify({ logger: false, forceCloseConnections: true });
  const sockets = new Set<Socket>();
  app.server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  app.addHook("preHandler", async (request, reply) => {
    requests.push({ method: request.method, path: request.url, body: request.body });
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

  const full = (): Json => ({ state, info: info(), effects: seed.effects, palettes: seed.palettes });

  app.get("/json", async () => full());
  app.get("/json/state", async () => state);
  app.get("/json/info", async () => info());
  app.get("/json/si", async () => ({ state, info: info() }));
  app.get("/json/effects", async () => seed.effects);
  app.get("/json/fxdata", async () => seed.fxdata);
  app.get("/json/palettes", async () => seed.palettes);
  app.get("/json/pal", async () => seed.palettes);
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
  app.get("/presets.json", async () => seed.presets);

  app.get<{ Querystring: { p?: string } }>("/settings/s.js", async (request, reply) => {
    const page = Number(request.query.p ?? 0);
    if (page > 0 && locked()) return reply.code(401).type("text/plain").send("");
    reply.type("application/javascript");
    return page === 2 ? sjs : "function GetV(){var d=document;}";
  });

  const postState = async (request: FastifyRequest, reply: FastifyReply, view: () => unknown) => {
    const body = isObject(request.body) ? request.body : {};
    checkPin(body);
    for (const [key, value] of Object.entries(body)) {
      if (key === "v" || key === "pin" || key === "rb") continue;
      if (key === "seg") applySegments(state, value);
      else if (isObject(value) && isObject(state[key])) state[key] = { ...(state[key] as Json), ...clone(value) };
      else state[key] = clone(value);
    }
    if (body.rb === true) restart();
    return reply.send(body.v === true ? view() : { success: true });
  };
  app.post("/json", (request, reply) => postState(request, reply, full));
  app.post("/json/state", (request, reply) => postState(request, reply, () => state));
  app.post("/json/si", (request, reply) => postState(request, reply, () => ({ state, info: info() })));

  app.post("/json/cfg", async (request, reply) => {
    const body = isObject(request.body) ? request.body : {};
    checkPin(body);
    if (locked()) return reply.code(401).send({ error: 1 });
    for (const [key, value] of Object.entries(body)) {
      if (key === "pin") continue;
      if (key === "nw" && isObject(value)) cfg.nw = mergeNetwork(cfg.nw as Json, value);
      else if (key === "ap" && isObject(value)) cfg.ap = mergeAp(cfg.ap as Json, value);
      else cfg[key] = clone(value);
    }
    return { success: true };
  });

  await app.listen({ host: "127.0.0.1", port: 0 });
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
    restart,
    cfg,
    state,
    close() {
      closing ??= (async () => {
        sockets.forEach((s) => s.destroy());
        await app.close();
      })();
      return closing;
    },
  };
}

/** Merges `seg` from a state POST into the segments, by `id` (or the array index when there is none). */
function applySegments(state: Json, value: unknown): void {
  const segs = (state.seg as Json[] | undefined) ?? [];
  const updates = Array.isArray(value) ? value : [value];
  updates.forEach((update: unknown, i) => {
    if (!isObject(update)) return;
    const id = typeof update.id === "number" ? update.id : Array.isArray(value) ? i : ((state.mainseg as number) ?? 0);
    const current = segs.find((s) => s.id === id);
    if (current) Object.assign(current, clone(update), { id });
    else segs.push({ ...clone(update), id });
  });
  state.seg = segs;
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
  return { ...clone(next), ins };
}

// cfg.cpp: `ap.psk` is copied with no check, so "" makes the access point open.
function mergeAp(current: Json, next: Json): Json {
  const { pskl: _pskl, ...rest } = clone(next);
  return withPskLength(rest, next.psk, current.pskl);
}
