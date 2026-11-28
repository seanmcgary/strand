import { Bonjour } from "bonjour-service";
import mdns from "multicast-dns";

const isIpv4 = (address: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(address);

const MAX_SERVICES = 128;

export const browseWled = (windowMs: number): Promise<{ host: string; port: number; addresses: string[] }[]> =>
  new Promise((resolve) => {
    const found: { host: string; port: number; addresses: string[] }[] = [];
    let bonjour: Bonjour | undefined;
    let browser: { stop: () => void } | undefined;
    let timer: NodeJS.Timeout | undefined;
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      try {
        browser?.stop();
      } catch {
        // The browser is already stopped.
      }
      try {
        bonjour?.destroy();
      } catch {
        // The socket is already gone.
      }
      resolve(found);
    };
    try {
      bonjour = new Bonjour({}, () => finish());
      (bonjour as unknown as { server: { mdns: NodeJS.EventEmitter } }).server.mdns.on("error", () => finish());
      browser = bonjour.find({ type: "wled" }, (service) => {
        if (
          found.length >= MAX_SERVICES ||
          !(Number.isInteger(service.port) && service.port >= 1 && service.port <= 65535) ||
          typeof service.host !== "string" ||
          service.host.length > 253
        ) {
          return;
        }
        found.push({
          host: service.host,
          port: service.port,
          addresses: (service.addresses ?? []).filter(isIpv4).slice(0, 8),
        });
      });
      timer = setTimeout(finish, windowMs);
    } catch {
      found.length = 0;
      finish();
    }
  });

export const resolveA = (host: string, timeoutMs: number): Promise<string | null> =>
  new Promise((resolve) => {
    let socket: ReturnType<typeof mdns> | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: string | null) => {
      clearTimeout(timer);
      try {
        socket?.destroy();
      } catch {
        // The socket is already gone.
      }
      resolve(value);
    };
    try {
      const wanted = host.toLowerCase();
      socket = mdns();
      socket.on("error", () => finish(null));
      socket.on("response", (packet) => {
        for (const a of packet.answers) {
          if (a.type === "A" && a.name.toLowerCase() === wanted && isIpv4(a.data)) {
            finish(a.data);
            return;
          }
        }
      });
      timer = setTimeout(() => finish(null), timeoutMs);
      socket.query({ questions: [{ name: host, type: "A" }] });
    } catch {
      finish(null);
    }
  });
