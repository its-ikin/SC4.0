import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calendarDaysBetween, expiryPresentation, formatLocalDate } from "../../client/src/lib/dateTime";

const localIso = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString();

describe("inventory expiry dates", () => {
  it("reports expiry today without a positive remaining count", () => {
    const now = new Date(2026, 6, 17, 23, 45);
    assert.deepEqual(expiryPresentation(localIso(2026, 7, 17, 0), now), { days: 0, label: "Expires today", state: "critical" });
  });

  it("reports already expired stock as elapsed days", () => {
    const result = expiryPresentation(localIso(2026, 7, 10), new Date(2026, 6, 17, 8));
    assert.equal(result.days, -7);
    assert.equal(result.label, "Expired 7 days ago");
    assert.equal(result.state, "expired");
  });

  it("uses the stored year for next-year expiry", () => {
    assert.equal(calendarDaysBetween(localIso(2027, 7, 17), new Date(2026, 6, 17, 8)), 365);
    assert.match(formatLocalDate(localIso(2027, 7, 17)), /2027/);
  });

  it("handles the year-end transition", () => {
    assert.equal(calendarDaysBetween(localIso(2027, 1, 1), new Date(2026, 11, 31, 23)), 1);
  });

  it("handles leap-day transitions", () => {
    assert.equal(calendarDaysBetween(localIso(2028, 3, 1), new Date(2028, 1, 28, 12)), 2);
  });

  it("handles missing expiry dates", () => {
    assert.deepEqual(expiryPresentation(null), { days: null, label: "No expiry date", state: "missing" });
  });

  it("uses local calendar dates across a midnight boundary", () => {
    const beforeMidnight = localIso(2026, 12, 31, 23);
    const afterMidnight = new Date(2027, 0, 1, 0, 30);
    assert.equal(calendarDaysBetween(beforeMidnight, afterMidnight), -1);
  });
});

