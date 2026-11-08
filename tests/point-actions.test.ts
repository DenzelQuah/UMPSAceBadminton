import { beforeEach,describe,expect,it,vi } from "vitest"
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),from:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requireAuthenticated:mocks.auth,requireCommittee:vi.fn()}))
vi.mock("@/app/actions/user",()=>({getCurrentUserWithRoles:vi.fn()}))
import { adjustMatchPoint } from "../app/actions/matchOperations"
const id="60000000-0000-4000-8000-000000000001",operationId="60000000-0000-4000-8000-000000000002"
const command={matchId:id,gameNumber:1,side:"a" as const,delta:1 as const,expectedVersion:4,operationId}
const snapshot={match_id:id,category_id:id,group_id:null,status:"IN_PROGRESS",winner_id:null,version:5,updated_at:"2026-11-09T00:00:00Z",games:[{gameNumber:1,playerAScore:1,playerBScore:0}]}
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,userId:"umpire",supabase:{rpc:mocks.rpc,from:mocks.from}});mocks.rpc.mockResolvedValue({data:snapshot,error:null})})
describe("single round-trip point commands",()=>{
  it.each([1,-1] as const)("sends a %i adjustment with the same operation ID and expected version in one RPC",async(delta)=>{
    expect(await adjustMatchPoint({...command,delta})).toMatchObject({success:true,data:snapshot})
    expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith("adjust_match_point",{match_uuid:id,game_number_value:1,side_value:"a",delta_value:delta,expected_version:4,operation_uuid:operationId})
  })
  it("requires authentication before invoking the scoring RPC",async()=>{
    mocks.auth.mockResolvedValue({ok:false,response:{success:false,error:{status:401,code:"UNAUTHORIZED",message:"Sign in"}}})
    expect(await adjustMatchPoint(command)).toMatchObject({success:false,error:{status:401}});expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("rejects invalid command identities or multi-point deltas before writing",async()=>{
    expect(await adjustMatchPoint({...command,operationId:"invalid"})).toMatchObject({success:false,error:{code:"VALIDATION_ERROR"}})
    expect(await adjustMatchPoint({...command,delta:2 as 1})).toMatchObject({success:false,error:{code:"VALIDATION_ERROR"}})
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it("returns an explicit score conflict for a stale device",async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code:"40001"}})
    expect(await adjustMatchPoint(command)).toMatchObject({success:false,error:{code:"SCORE_CONFLICT",status:409}})
  })
  it("reports setup errors and never acknowledges an unverifiable saved score",async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"PGRST202"}})
    expect(await adjustMatchPoint(command)).toMatchObject({success:false,error:{code:"DATABASE_SETUP_REQUIRED"}})
    mocks.rpc.mockResolvedValueOnce({data:{},error:null})
    expect(await adjustMatchPoint(command)).toMatchObject({success:false,error:{code:"DATABASE_ERROR"}})
  })
})
