import { describe,expect,it } from "vitest"
import { canEditMatchSchedule,malaysiaDateTimeInput,malaysiaDateTimeToIso,matchScheduleHref } from "../lib/tournament/match-scheduling"

describe("TBA scheduling and Malaysia time",()=>{
  it("allows MT to edit an active fixture before it has a time, independent of the round",()=>{
    expect(canEditMatchSchedule({status:"SCHEDULED",category_status:"DRAW_PUBLISHED",tournament_status:"DRAW_PUBLISHED"})).toBe(true)
    expect(canEditMatchSchedule({status:"SCHEDULED",category_status:"KNOCKOUT_IN_PROGRESS",tournament_status:"KNOCKOUT_IN_PROGRESS"})).toBe(true)
  })
  it("keeps started matches and terminal tournaments locked",()=>{
    for(const status of ["READY","IN_PROGRESS","COMPLETED","WALKOVER","RETIRED","CANCELLED"])expect(canEditMatchSchedule({status})).toBe(false)
    expect(canEditMatchSchedule({status:"SCHEDULED",category_status:"COMPLETED"})).toBe(false)
    expect(canEditMatchSchedule({status:"SCHEDULED",tournament_status:"ARCHIVED"})).toBe(false)
    expect(canEditMatchSchedule({status:"SCHEDULED",category_status:"DRAW_GENERATED"})).toBe(false)
  })
  it("opens the correct category and match instead of defaulting to the first category",()=>{
    expect(matchScheduleHref("event","second-category","quarterfinal")).toBe("/admin/tournaments/event?category=second-category&schedule=quarterfinal#match-schedule")
  })
  it("keeps TBA blank in the editor and never substitutes the current time",()=>{
    expect(malaysiaDateTimeInput(null)).toBe("")
    expect(malaysiaDateTimeInput(undefined)).toBe("")
    expect(malaysiaDateTimeToIso("")).toBeNull()
  })
  it("formats and parses MYT independently of the operating system's timezone",()=>{
    expect(malaysiaDateTimeInput("2026-11-10T02:00:00Z")).toBe("2026-11-10T10:00")
    expect(malaysiaDateTimeToIso("2026-11-10T10:00")).toBe("2026-11-10T02:00:00.000Z")
    expect(malaysiaDateTimeInput("2026-11-09T16:00:00Z")).toBe("2026-11-10T00:00")
    expect(malaysiaDateTimeToIso("2026-11-10T00:00")).toBe("2026-11-09T16:00:00.000Z")
  })
  it.each(["invalid","2026-02-30T10:00","2026-11-10T25:00","2026-11-10T10:60","2026-11-10T10:00Z"])("rejects invalid local input %s",(value)=>{
    expect(malaysiaDateTimeToIso(value)).toBeNull()
  })
})
