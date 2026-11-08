import { describe, expect, it } from "vitest"

import { getMatchStageLabel } from "../lib/tournament/stages"

describe("match stage labels", () => {
  it("distinguishes group and knockout stages", () => {
    expect(getMatchStageLabel({ group_id: "group-a", knockout_round: null })).toBe("Group stage")
    expect(getMatchStageLabel({ group_id: null, knockout_round: 1 })).toBe("Quarter-final")
    expect(getMatchStageLabel({ group_id: null, knockout_round: 2 })).toBe("Semi-final")
    expect(getMatchStageLabel({ group_id: null, knockout_round: 3 })).toBe("Final")
    expect(getMatchStageLabel({ knockout_round: 1, knockout_stage: "Round of 16" })).toBe("Round of 16")
  })

  it("falls back safely for matches without a stage", () => {
    expect(getMatchStageLabel({ group_id: null, knockout_round: null })).toBe("Match")
    expect(getMatchStageLabel({ knockout_round: 9 })).toBe("Knockout round 9")
  })
})
