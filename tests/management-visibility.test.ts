import { describe,expect,it,vi } from "vitest"
import { approvedRole,canApplyForCommitteeRoles,canAssignMatchOfficials,canManageTournaments,isPlatformAdministrator,type ApprovedRoleSource } from "../lib/auth/organizational-roles"
import { readActorProfile } from "../lib/auth/actor-profile"
import { availableWorkspaces } from "../lib/auth/workspaces"

describe("management and lower-role application visibility",()=>{
  it("grants match assignments to MT, EXCO and Admin without promoting EXCO to tournament management",()=>{
    for(const role of ["MT","mt","EXCO","Exco","Admin","SYSTEM_ADMIN"])expect(canAssignMatchOfficials({role})).toBe(true)
    for(const role of ["PLAYER","AJK","UMPIRE","LINESMAN","unknown"])expect(canAssignMatchOfficials({role})).toBe(false)
    expect(canAssignMatchOfficials(null)).toBe(false)
    expect(canManageTournaments({role:"EXCO"})).toBe(false)
  })
  it.each([
    {role:"MT"},{role:"mt"},{user_role:"MT"},{organizational_role:"MT"},
    {role:"Admin"},{role:"SYSTEM_ADMIN"},{user_role:"Admin"},{is_admin:true},
  ])("keeps management visible and lower-role forms hidden for %j",(profile)=>{
    expect(canManageTournaments(profile)).toBe(true)
    expect(canApplyForCommitteeRoles(profile)).toBe(false)
    expect(availableWorkspaces({isOrganizer:canManageTournaments(profile),isPlayer:true,isOfficial:true})).toContainEqual(expect.objectContaining({name:"MT Dashboard",href:"/mt"}))
  })
  it.each([{role:"Exco"},{user_role:"EXCO"},{organizational_role:"EXCO"}])("hides lower-role forms without giving EXCO management rights: %j",(profile)=>{
    expect(canApplyForCommitteeRoles(profile)).toBe(false);expect(canManageTournaments(profile)).toBe(false)
  })
  it("retains applications for regular players and never trusts signup metadata as an approved role",()=>{
    expect(canApplyForCommitteeRoles({organizational_role:"PLAYER"})).toBe(true)
    const profile={user_metadata:{role:"Admin",organizational_role:"MT"}} as unknown as ApprovedRoleSource
    expect(approvedRole(profile)).toBe("PLAYER");expect(canManageTournaments(profile)).toBe(false)
    expect(canManageTournaments({role:"unknown"})).toBe(false)
    expect(canApplyForCommitteeRoles(null)).toBe(false)
  })
  it.each(["MT","Admin","Exco"])("normalizes an authoritative role=%s response before computing dashboard permissions",async(role)=>{
    const client={rpc:vi.fn().mockResolvedValue({data:[{id:"approved-user",role,organizational_role:"PLAYER"}],error:null})}
    const result=await readActorProfile(client as unknown as Parameters<typeof readActorProfile>[0])
    expect(result.data?.user_role).toBe(role==="Admin" ? "SYSTEM_ADMIN":role.toUpperCase())
    expect(canManageTournaments(result.data)).toBe(role!=="Exco")
    expect(isPlatformAdministrator(result.data)).toBe(role==="Admin")
    expect(canApplyForCommitteeRoles(result.data)).toBe(false)
  })
})
