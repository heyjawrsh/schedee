import { describe, expect, it } from "vitest";
import { GoogleAuthError } from "./auth";
import { problemFor } from "./outbox";
import { GoogleApiError } from "./sync";

describe("problemFor", () => {
	it("calls a revoked or missing grant signed out", () => {
		expect(problemFor(new GoogleAuthError("invalid_grant"))).toBe("signed_out");
		expect(problemFor(new GoogleAuthError("not_signed_in"))).toBe("signed_out");
		expect(problemFor(new GoogleApiError(401, ""))).toBe("signed_out");
	});

	it("shows nothing while offline", () => {
		expect(problemFor(new TypeError("Failed to fetch"))).toBeUndefined();
	});

	it("calls anything else a failing sync", () => {
		expect(problemFor(new GoogleApiError(503, ""))).toBe("sync_failed");
		expect(problemFor(new GoogleAuthError("keychain: denied"))).toBe(
			"sync_failed",
		);
	});
});
