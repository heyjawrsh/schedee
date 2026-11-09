import { describe, expect, it } from "vitest";
import worker from "./index";

const call = (path: string, method = "GET") =>
	worker.fetch(new Request(`https://auth.sched.ee${path}`, { method }));

describe("worker", () => {
	it("answers health checks", async () => {
		const res = await call("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	it("404s everything else", async () => {
		expect((await call("/")).status).toBe(404);
		expect((await call("/health", "POST")).status).toBe(404);
	});
});
