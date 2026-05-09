import { describe, expect, it } from "vitest";
import { composeSearchJql } from "../src/jira.js";

describe("composeSearchJql", () => {
  it("returns a base ORDER BY when no input is given", () => {
    expect(composeSearchJql({})).toBe("ORDER BY updated DESC");
  });

  it("scopes to a project when projectKey is supplied", () => {
    expect(composeSearchJql({ projectKey: "EEPD" })).toBe(
      "project = EEPD ORDER BY updated DESC",
    );
  });

  it("project chip filter wins over the default projectKey", () => {
    const jql = composeSearchJql({
      projectKey: "EEPD",
      filters: [{ kind: "project", value: "OPS" }],
    });
    expect(jql).toBe("project = OPS ORDER BY updated DESC");
  });

  it("composes a free-text query with quote escaping", () => {
    const jql = composeSearchJql({ q: 'spacing "issue"', projectKey: "EEPD" });
    expect(jql).toBe(
      'project = EEPD AND (text ~ "spacing \\"issue\\"" OR key = "spacing \\"issue\\"") ORDER BY updated DESC',
    );
  });

  it("translates status chip to statusCategory clause", () => {
    const jql = composeSearchJql({
      filters: [{ kind: "status", value: "open" }],
    });
    expect(jql).toBe('statusCategory = "To Do" ORDER BY updated DESC');
  });

  it("assignee=me uses currentUser()", () => {
    const jql = composeSearchJql({
      filters: [{ kind: "assignee", value: "me" }],
    });
    expect(jql).toBe("assignee = currentUser() ORDER BY updated DESC");
  });

  it("assignee=unassigned uses IS EMPTY", () => {
    const jql = composeSearchJql({
      filters: [{ kind: "assignee", value: "unassigned" }],
    });
    expect(jql).toBe("assignee is EMPTY ORDER BY updated DESC");
  });

  it("translates updated chip to startOfWeek()", () => {
    const jql = composeSearchJql({
      filters: [{ kind: "updated", value: "this_week" }],
    });
    expect(jql).toBe("updated >= startOfWeek() ORDER BY updated DESC");
  });

  it("composes multiple chips with AND in declaration order", () => {
    const jql = composeSearchJql({
      q: "tailwind",
      projectKey: "EEPD",
      filters: [
        { kind: "status", value: "in_progress" },
        { kind: "assignee", value: "me" },
        { kind: "updated", value: "this_week" },
        { kind: "type", value: "Bug" },
      ],
    });
    expect(jql).toBe(
      'project = EEPD AND (text ~ "tailwind" OR key = "tailwind") AND statusCategory = "In Progress" AND assignee = currentUser() AND updated >= startOfWeek() AND issuetype = "Bug" ORDER BY updated DESC',
    );
  });

  it("ignores empty-value chips", () => {
    const jql = composeSearchJql({
      filters: [
        { kind: "status", value: "" },
        { kind: "assignee", value: "" },
      ],
    });
    expect(jql).toBe("ORDER BY updated DESC");
  });
});
