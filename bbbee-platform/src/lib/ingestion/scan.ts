import net from "node:net";
import { env } from "../env";

export interface ScanResult {
  status: "CLEAN" | "INFECTED" | "NOT_SCANNED";
  detail: string;
}

export interface MalwareScanner {
  scan(data: Buffer): Promise<ScanResult>;
}

/** ClamAV clamd INSTREAM protocol. */
export class ClamdScanner implements MalwareScanner {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 60_000) {}

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let response = "";
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error("clamd timeout")));
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const chunkSize = 64 * 1024;
        for (let i = 0; i < data.length; i += chunkSize) {
          const chunk = data.subarray(i, i + chunkSize);
          const len = Buffer.alloc(4);
          len.writeUInt32BE(chunk.length);
          socket.write(len);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
      socket.on("data", (d) => (response += d.toString()));
      socket.on("end", () => {
        const r = response.replace(/\0/g, "").trim();
        if (r.endsWith("OK")) resolve({ status: "CLEAN", detail: r });
        else if (r.includes("FOUND")) resolve({ status: "INFECTED", detail: r });
        else reject(new Error(`Unexpected clamd response: ${r}`));
      });
      socket.on("error", reject);
    });
  }
}

/** Used when no scanner is configured: files are held as NOT_SCANNED (quarantined from AI processing). */
export class NoopScanner implements MalwareScanner {
  async scan(): Promise<ScanResult> {
    return { status: "NOT_SCANNED", detail: "No malware scanner configured (CLAMAV_HOST unset)." };
  }
}

let scanner: MalwareScanner | undefined;

export function malwareScanner(): MalwareScanner {
  if (!scanner) {
    const e = env();
    scanner = e.CLAMAV_HOST ? new ClamdScanner(e.CLAMAV_HOST, e.CLAMAV_PORT) : new NoopScanner();
  }
  return scanner;
}

export function setScannerForTesting(s: MalwareScanner): void {
  scanner = s;
}
