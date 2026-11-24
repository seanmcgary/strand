import { Bonjour } from "bonjour-service";
import mdns from "multicast-dns";

const isIpv4 = (address: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(address);

export const browseWled = (windowMs: number): Promise<{ host: string; port: number; addresses: string[] }[]> =>
  new Promise((resolve) => {
    const found: { host: string; port: number; addresses: string[] }[] = [];
    let bonjour: Bonjour | undefined;
    try {
      bonjour = new Bonjour();
      const browser = bonjour.find({ type: "wled" }, (service) => {
        found.push({
          host: service.host,
          port: service.port,
          addresses: (service.addresses ?? []).filter(isIpv4),
        });
      });
      setTimeout(() => {
        try {
          browser.stop();
          bonjour?.destroy();
        } catch {
          // The socket is already gone.
        }
        resolve(found);
      }, windowMs);
    } catch {
      try {
        bonjour?.destroy();
      } catch {
        // The socket is already gone.
      }
      resolve([]);
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
