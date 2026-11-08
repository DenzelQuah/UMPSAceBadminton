import { beforeEach,describe,expect,it,vi } from "vitest"
const mocks=vi.hoisted(()=>({auth:vi.fn(),from:vi.fn(),select:vi.fn(),or:vi.fn(),in:vi.fn(),order:vi.fn(),rpc:vi.fn(),limit:vi.fn()}))
vi.mock("@/lib/auth/authorization",()=>({requireAuthenticated:mocks.auth,requireCommittee:vi.fn()}))
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}))
import { getUpcomingPlayerMatches } from "../app/actions/matches"

const id="00000000-0000-4000-8000-000000000001"
const row={id:"fixture",category_id:"category",player_a_id:"captain",player_a_partner_id:id,player_b_id:"opponent",status:"SCHEDULED",scheduled_time:"2026-11-10T02:00:00Z",court_number:3,created_at:"2026-11-09T00:00:00Z",
  category:{name:"Mixed doubles",status:"DRAW_PUBLISHED",tournament:{id:"event",title:"UMPSA Open",location:"Sports Complex",status:"DRAW_PUBLISHED"}}}
beforeEach(()=>{
  vi.clearAllMocks()
  const chain={select:mocks.select,or:mocks.or,in:mocks.in,order:mocks.order,limit:mocks.limit}
  for(const fn of [mocks.from,mocks.select,mocks.or,mocks.in])fn.mockReturnValue(chain)
  mocks.auth.mockResolvedValue({ok:true,userId:id,supabase:{from:mocks.from,rpc:mocks.rpc}})
  mocks.order.mockResolvedValue({data:[row],error:null})
  mocks.rpc.mockResolvedValue({data:[{category_id:"category",representative_id:"captain",display_name:"Captain / Partner"},{category_id:"category",representative_id:"opponent",display_name:"Opponent / Other partner"}],error:null})
  mocks.limit.mockResolvedValue({data:null,error:{code:"42703"}})
})
describe("authenticated schedule queries",()=>{
  it("filters all four participant slots using the session ID and filters statuses before fetching",async()=>{
    const result=await getUpcomingPlayerMatches()
    expect(mocks.or).toHaveBeenCalledWith(`player_a_id.eq.${id},player_b_id.eq.${id},player_a_partner_id.eq.${id},player_b_partner_id.eq.${id}`)
    expect(mocks.in).toHaveBeenCalledWith("status",["SCHEDULED","READY","IN_PROGRESS","POSTPONED"])
    expect(result).toMatchObject({success:true,data:[{tournament_id:"event",court_number:3,category_name:"Mixed doubles",tournament_title:"UMPSA Open",tournament_location:"Sports Complex",player_b_name:"Opponent / Other partner"}]})
  })
  it("does not return another player's fixture or terminal matches even if a query returns them",async()=>{
    mocks.order.mockResolvedValue({data:[{...row,player_a_partner_id:null},{...row,status:"COMPLETED"},{...row,category:{...row.category,status:"ARCHIVED"}}],error:null})
    expect(await getUpcomingPlayerMatches()).toEqual({success:true,data:[]})
  })
  it("requires a session without querying anonymously",async()=>{
    mocks.auth.mockResolvedValue({ok:false,response:{success:false,error:{code:"UNAUTHORIZED",status:401,message:"Sign in"}}})
    expect(await getUpcomingPlayerMatches()).toMatchObject({success:false,error:{status:401}})
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it("does not disguise a database failure as an empty schedule",async()=>{
    mocks.order.mockResolvedValue({data:null,error:{code:"42501"}})
    expect(await getUpcomingPlayerMatches()).toMatchObject({success:false,error:{code:"DATABASE_ERROR"}})
    expect(mocks.order).toHaveBeenCalledTimes(1)
  })
  it("only falls back to two participant columns on a proven singles-only schema",async()=>{
    mocks.order.mockResolvedValueOnce({data:null,error:{code:"42703"}}).mockResolvedValueOnce({data:[{...row,player_a_id:id,player_a_partner_id:null}],error:null})
    expect((await getUpcomingPlayerMatches()).success).toBe(true)
    expect(mocks.limit).toHaveBeenCalledWith(0)
    expect(mocks.or).toHaveBeenLastCalledWith(`player_a_id.eq.${id},player_b_id.eq.${id}`)
  })
  it("keeps doubles membership intact when a partial schema cache causes an error",async()=>{
    mocks.order.mockResolvedValue({data:null,error:{code:"PGRST204"}})
    mocks.limit.mockResolvedValue({data:[],error:null})
    expect(await getUpcomingPlayerMatches()).toMatchObject({success:false,error:{code:"DATABASE_SETUP_REQUIRED"}})
    expect(mocks.order).toHaveBeenCalledTimes(1)
  })
})
