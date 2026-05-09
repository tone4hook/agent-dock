import { describe, expect, it } from "vitest";
import { composeSearchCql } from "../src/confluence.js";

describe("composeSearchCql", () => {
  it("always scopes to type=page and orders by lastmodified", () => {
    expect(composeSearchCql({})).toBe('type = "page" ORDER BY lastmodified DESC');
  });

  it("emits a (title OR text) clause for free text with quote escaping", () => {
    const cql = composeSearchCql({ q: 'onboarding "runbook"' });
    expect(cql).toBe(
      'type = "page" AND (title ~ "onboarding \\"runbook\\"" OR text ~ "onboarding \\"runbook\\"") ORDER BY lastmodified DESC',
    );
  });

  it("scopes to a space when the space chip is set", () => {
    const cql = composeSearchCql({ filters: [{ kind: "space", value: "EEN-DEV" }] });
    expect(cql).toBe('type = "page" AND space = "EEN-DEV" ORDER BY lastmodified DESC');
  });

  it("author=me uses currentUser()", () => {
    const cql = composeSearchCql({ filters: [{ kind: "author", value: "me" }] });
    expect(cql).toBe('type = "page" AND creator = currentUser() ORDER BY lastmodified DESC');
  });

  it("translates updated chip to a now(-Nd) clause", () => {
    const cql = composeSearchCql({ filters: [{ kind: "updated", value: "this_week" }] });
    expect(cql).toBe(
      'type = "page" AND lastmodified >= "now(-7d)" ORDER BY lastmodified DESC',
    );
  });

  it("emits a label clause for the label chip", () => {
    const cql = composeSearchCql({ filters: [{ kind: "label", value: "runbook" }] });
    expect(cql).toBe('type = "page" AND label = "runbook" ORDER BY lastmodified DESC');
  });

  it("composes multiple chips with AND in declaration order", () => {
    const cql = composeSearchCql({
      q: "tailwind",
      filters: [
        { kind: "space", value: "WEB" },
        { kind: "author", value: "me" },
        { kind: "updated", value: "this_month" },
        { kind: "label", value: "migration" },
      ],
    });
    expect(cql).toBe(
      'type = "page" AND (title ~ "tailwind" OR text ~ "tailwind") AND space = "WEB" AND creator = currentUser() AND lastmodified >= "now(-30d)" AND label = "migration" ORDER BY lastmodified DESC',
    );
  });

  it("ignores empty-value chips", () => {
    const cql = composeSearchCql({
      filters: [
        { kind: "space", value: "" },
        { kind: "label", value: "" },
      ],
    });
    expect(cql).toBe('type = "page" ORDER BY lastmodified DESC');
  });

  it("escapes backslashes in chip values", () => {
    const cql = composeSearchCql({ filters: [{ kind: "label", value: "a\\b" }] });
    expect(cql).toBe('type = "page" AND label = "a\\\\b" ORDER BY lastmodified DESC');
  });
});
