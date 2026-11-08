import { beforeEach,describe,expect,it,vi } from "vitest"
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),committee:vi.fn(),from:vi.fn(),revalidate:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requireMatchOfficialManager:mocks.auth,requireCommittee:mocks.committee}))
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}))
import { assignOfficial,getMatchOfficialAvailability } from "../app/actions/officials"

const id="90000000-0000-4000-8000-000000000001",umpire="90000000-0000-4000-8000-000000000002",linesman="90000000-0000-4000-8000-000000000003"
const command={matchId:id,umpireId:umpire,linesmanId:linesman}
beforeEach(()=>{
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ok:true,userId:umpire,supabase:{rpc:mocks.rpc,from:mocks.from}})
  mocks.rpc.mockResolvedValue({data:[{id,umpire_id:umpire,linesman_id:linesman}],error:null})
})
describe("match official assignment server actions",()=>{
  it("writes both slots atomically through the scoped RPC without granting EXCO broad reads or writes",async()=>{
    expect(await assignOfficial(command)).toMatchObject({success:true})
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("assign_match_officials",{match_uuid:id,umpire_uuid:umpire,linesman_uuid:linesman})
    expect(mocks.committee).not.toHaveBeenCalled();expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith("/umpire")
    expect(mocks.revalidate).toHaveBeenCalledWith("/tournaments/[tournamentId]","page")
  })
  it("fetches one specific match's roster through its permission-checked database function",async()=>{
    const context={match:{id},officials:[]};mocks.rpc.mockResolvedValue({data:context,error:null})
    expect(await getMatchOfficialAvailability(id)).toEqual({success:true,data:context})
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_match_official_availability",{match_uuid:id})
  })
  it.each([401,403])("stops an unauthorized %i request before database access",async(status)=>{
    mocks.auth.mockResolvedValue({ok:false,response:{success:false,error:{status,code:"AUTH_FORBIDDEN",message:"Access required"}}})
    expect(await assignOfficial(command)).toMatchObject({success:false,error:{status}})
    expect(await getMatchOfficialAvailability(id)).toMatchObject({success:false,error:{status}})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("rejects malformed identifiers and incomplete assignments before writing",async()=>{
    expect(await assignOfficial({...command,umpireId:"invalid"})).toMatchObject({success:false,error:{code:"VALIDATION_ERROR"}})
    expect(await assignOfficial({matchId:id} as typeof command)).toMatchObject({success:false,error:{code:"VALIDATION_ERROR"}})
    expect(await getMatchOfficialAvailability("invalid")).toMatchObject({success:false,error:{code:"VALIDATION_ERROR"}})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it.each([["P0001","SCHEDULE_CONFLICT",409],["42501","AUTH_FORBIDDEN",403],["22023","VALIDATION_ERROR",422],["P0002","NOT_FOUND",404],["PGRST202","DATABASE_SETUP_REQUIRED",503]])("reports %s without acknowledging a saved assignment",async(code,apiCode,status)=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code}})
    expect(await assignOfficial(command)).toMatchObject({success:false,error:{code:apiCode,status}})
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("does not report success if the database cannot confirm both saved official IDs",async()=>{
    mocks.rpc.mockResolvedValue({data:[],error:null})
    expect(await assignOfficial(command)).toMatchObject({success:false,error:{code:"DATABASE_ERROR"}})
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})
