import type { FastifyInstance } from "fastify";
import type { DiscoveredDevice } from "../../shared/apiTypes";
import type { AppDeps } from "../app";
import * as devices from "../db/devices";
import { deviceRequest, fetchInfo, isPrivateIpv4 } from "../wled/deviceClient";
import { LABEL, targetOf, toDiscovered } from "./devices";

/** The most addresses one discovery request sends `/json/info` to. */
const MAX_CANDIDATES = 64;

type Candidate = { ip: string; port: number; host: string | null };

/** The addresses from `GET /json/nodes` of every saved device. A saved device that does not answer adds none. */
async function nodeCandidates(deps: AppDeps): Promise<Candidate[]> {
  const lists = await Promise.all(
    devices.list(deps.db).map((row) =>
      deviceRequest<{ nodes?: { ip?: unknown }[] }>(deps, targetOf(row), "/json/nodes", { recover: false })
      .then((reply) => (Array.isArray(reply?.nodes) ? reply.nodes : []))
      .catch(() => []),
    ),
  );
  return lists
  .flat()
  .flatMap((node) => (typeof node?.ip === "string" ? [{ ip: node.ip, port: deps.wledPort, host: null }] : []));
}

/** The mDNS name of a device that was found through nodes: `<id.mdns>.local`, or `null` when it has none. */
async function mdnsHostOf(deps: AppDeps, ip: string, port: number): Promise<string | null> {
  try {
    const cfg = await deviceRequest<{ id?: { mdns?: unknown } }>(
      deps,
      { name: ip, host: ip, port, lastIp: ip },
      "/json/cfg",
      { recover: false },
    );
    const name = cfg?.id?.mdns;
    return typeof name === "string" && LABEL.test(name) ? `${name}.local` : null;
  } catch {
    return null;
  }
}

export async function discoveryRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get("/api/discovery", async (): Promise<DiscoveredDevice[]> => {
    const [services, nodes] = await Promise.all([
      deps.mdns.browseWled(deps.config.discoveryWindowMs),
      nodeCandidates(deps),
    ]);

    const fromMdns = services.flatMap((service) =>
      service.addresses.map((ip): Candidate => ({ ip, port: service.port, host: service.host })),
    );
    const seen = new Set<string>();
    const candidates = [...fromMdns, ...nodes]
    .filter((c) => isPrivateIpv4(c.ip))
    .filter((c) => {
      const key = `${c.ip}:${c.port}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CANDIDATES);

    const found = await Promise.all(
      candidates.map(async (c) => {
        const info = await fetchInfo(deps, c.ip, c.port);
        if (!info) return null;
        return { ...c, info, host: c.host ?? (await mdnsHostOf(deps, c.ip, c.port)) ?? c.ip };
      }),
    );

    const byMac = new Map<string, NonNullable<(typeof found)[number]>>();
    for (const item of found) {
      if (item && !byMac.has(item.info.mac)) byMac.set(item.info.mac, item);
    }

    const now = deps.now();
    return [...byMac.values()]
    .map(({ ip, host, info }) => {
      const saved = devices.getByMac(deps.db, info.mac);
      if (saved && saved.lastIp !== ip) devices.setLastIp(deps.db, saved.id, ip, now);
      return toDiscovered({ ip, host, info }, saved !== undefined);
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.mac.localeCompare(b.mac));
  });
}
