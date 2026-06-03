// src/reddit/redditApi.test.ts
import { describe, it, expect, vi } from "vitest";
import { parseListing, fetchAppToken, createRedditApiRunner } from "./redditApi";

/** Minimal Response-like stub for the injected FetchFn. */
function resp(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const config = { clientId: "id", clientSecret: "sec", userAgent: "ape-signal/test" };

describe("parseListing", () => {
  it("maps a hot listing into RawRedditPost rows (numbers as strings)", () => {
    const listing = {
      data: {
        children: [
          { kind: "t3", data: { title: "$GME squeeze", score: 1200, num_comments: 45 } },
          { kind: "t3", data: { title: "$KSS run", score: 0, num_comments: 1 } },
        ],
      },
    };
    expect(parseListing(listing)).toEqual([
      { title: "$GME squeeze", score: "1200", comments: "45" },
      { title: "$KSS run", score: "0", comments: "1" },
    ]);
  });

  it("drops children without a title and tolerates missing fields", () => {
    const listing = {
      data: {
        children: [
          { kind: "t3", data: { score: 5, num_comments: 2 } }, // no title -> dropped
          { kind: "t3", data: { title: "AMC" } }, // missing score/comments
        ],
      },
    };
    expect(parseListing(listing)).toEqual([{ title: "AMC", score: undefined, comments: undefined }]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseListing(null)).toEqual([]);
    expect(parseListing({})).toEqual([]);
    expect(parseListing({ data: {} })).toEqual([]);
  });
});

describe("fetchAppToken", () => {
  it("posts client_credentials with basic auth and returns the access token", async () => {
    const fetchFn = vi.fn(async () => resp({ access_token: "tok123", token_type: "bearer", expires_in: 3600 }));
    const token = await fetchAppToken(config, { fetchFn });
    expect(token).toBe("tok123");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://www.reddit.com/api/v1/access_token");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("grant_type=client_credentials");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("id:sec").toString("base64")}`);
    expect(headers["User-Agent"]).toBe("ape-signal/test");
  });

  it("throws when the token request fails", async () => {
    const fetchFn = vi.fn(async () => resp({}, false, 401));
    await expect(fetchAppToken(config, { fetchFn })).rejects.toThrow(/401/);
  });

  it("throws when the response has no access_token", async () => {
    const fetchFn = vi.fn(async () => resp({ error: "nope" }));
    await expect(fetchAppToken(config, { fetchFn })).rejects.toThrow(/access_token/);
  });
});

describe("createRedditApiRunner", () => {
  it("authenticates once then fetches each subreddit's hot listing with the bearer token", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("access_token")) return resp({ access_token: "tok" });
      if (url.includes("/r/wallstreetbets/")) {
        return resp({ data: { children: [{ data: { title: "$KSS", score: 50, num_comments: 5 } }] } });
      }
      return resp({ data: { children: [{ data: { title: "$GME", score: 9, num_comments: 1 } }] } });
    });

    const run = createRedditApiRunner(config, { fetchFn });
    const out = await run(["wallstreetbets", "shortsqueeze"]);

    expect(out.wallstreetbets).toEqual([{ title: "$KSS", score: "50", comments: "5" }]);
    expect(out.shortsqueeze).toEqual([{ title: "$GME", score: "9", comments: "1" }]);
    // token fetched once + one request per subreddit
    expect(fetchFn).toHaveBeenCalledTimes(3);
    const listingCall = fetchFn.mock.calls.find((c) => String(c[0]).includes("/r/wallstreetbets/"))!;
    const headers = listingCall[1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("bearer tok");
    expect(String(listingCall[0])).toContain("oauth.reddit.com");
  });

  it("yields [] for every subreddit if the token request fails", async () => {
    const fetchFn = vi.fn(async () => resp({}, false, 401));
    const run = createRedditApiRunner(config, { fetchFn });
    const out = await run(["wallstreetbets", "shortsqueeze"]);
    expect(out).toEqual({ wallstreetbets: [], shortsqueeze: [] });
  });

  it("yields [] for a single failing subreddit but keeps the others", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("access_token")) return resp({ access_token: "tok" });
      if (url.includes("/r/bad/")) return resp({}, false, 500);
      return resp({ data: { children: [{ data: { title: "$GME", score: 9, num_comments: 1 } }] } });
    });
    const run = createRedditApiRunner(config, { fetchFn });
    const out = await run(["bad", "good"]);
    expect(out.bad).toEqual([]);
    expect(out.good).toEqual([{ title: "$GME", score: "9", comments: "1" }]);
  });
});
