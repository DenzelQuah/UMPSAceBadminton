import { isValidElement,type ReactElement } from "react"
import { beforeEach,describe,expect,it,vi } from "vitest"
const mocks=vi.hoisted(()=>({user:vi.fn(),tournament:vi.fn(),categories:vi.fn(),profiles:vi.fn(),features:vi.fn(),registrations:vi.fn(),matches:vi.fn(),preview:vi.fn()}))
vi.mock("@/app/actions/user",()=>({getCurrentUserWithRoles:mocks.user}))
vi.mock("@/app/actions/tournaments",()=>({getTournament:mocks.tournament,getCategoryDrawPreview:mocks.preview}))
vi.mock("@/app/actions/categories",()=>({getCategories:mocks.categories,getCategoryRegistrations:mocks.registrations}))
vi.mock("@/app/actions/matches",()=>({getCategoryMatches:mocks.matches}))
vi.mock("@/app/actions/officials",()=>({getAllProfiles:mocks.profiles}))
vi.mock("@/app/actions/setup",()=>({getTournamentFeatureStatus:mocks.features}))
vi.mock("@/app/(dashboard)/admin/tournaments/[tournamentId]/TournamentAdminClient",()=>({default:()=>null}))
vi.mock("next/navigation",()=>({redirect:(path:string)=>{throw Error(`redirect:${path}`)},notFound:()=>{throw Error("not found")}}))
import TournamentAdminPage from "../app/(dashboard)/admin/tournaments/[tournamentId]/page"

beforeEach(()=>{
  vi.clearAllMocks()
  mocks.user.mockResolvedValue({roles:{isOrganizer:true}})
  mocks.tournament.mockResolvedValue({success:true,data:{id:"event"}})
  mocks.categories.mockResolvedValue({success:true,data:[{id:"first"},{id:"second"}]})
  mocks.profiles.mockResolvedValue({success:true,data:[]})
  mocks.features.mockResolvedValue({success:false})
  mocks.registrations.mockResolvedValue({success:true,data:[]})
  mocks.matches.mockResolvedValue({success:true,data:[{id:"quarterfinal",scheduled_time:null,status:"SCHEDULED"}]})
  mocks.preview.mockResolvedValue({success:true,data:null})
})
async function open(category="second",schedule="quarterfinal"){
  const page=await TournamentAdminPage({params:Promise.resolve({tournamentId:"event"}),searchParams:Promise.resolve({category,schedule})})
  const children=(page.props as {children:ReactElement[]}).children
  const client=children.find((child)=>isValidElement(child) && "initialScheduleMatchId" in (child.props as object))!
  return client.props as {initialCategoryId:string;initialScheduleMatchId:string | null}
}
describe("direct MT scheduling navigation",()=>{
  it("selects a later category and opens its TBA match editor",async()=>{
    expect(await open()).toMatchObject({initialCategoryId:"second",initialScheduleMatchId:"quarterfinal"})
    expect(mocks.matches).toHaveBeenCalledWith("second");expect(mocks.registrations).toHaveBeenCalledWith("second")
  })
  it("does not open a match from an unrelated category",async()=>{
    expect(await open("second","unrelated-match")).toMatchObject({initialCategoryId:"second",initialScheduleMatchId:null})
  })
  it("falls back safely when a category is no longer present",async()=>{
    expect((await open("removed-category")).initialCategoryId).toBe("first")
  })
  it("blocks players and EXCO from opening the scheduling editor",async()=>{
    mocks.user.mockResolvedValue({roles:{isOrganizer:false}})
    await expect(open()).rejects.toThrow("redirect:/dashboard?error=unauthorized_admin")
    expect(mocks.matches).not.toHaveBeenCalled();expect(mocks.tournament).not.toHaveBeenCalled()
  })
})
