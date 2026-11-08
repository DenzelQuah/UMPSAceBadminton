import { z } from "zod"

export const liveScoreSchema = z.object({
  match_id:z.string().uuid(),category_id:z.string().uuid(),group_id:z.string().uuid().nullable(),
  status:z.string(),winner_id:z.string().uuid().nullable(),version:z.coerce.number().int().positive(),updated_at:z.string(),
  games:z.array(z.object({gameNumber:z.number().int().min(1).max(3),playerAScore:z.number().int().min(0).max(30),playerBScore:z.number().int().min(0).max(30)})).max(3),
})
export type LiveScore = z.infer<typeof liveScoreSchema>
export type LiveScores = Record<string,LiveScore>
export type ScoreConnection = "connecting" | "syncing" | "connected" | "reconnecting" | "offline" | "setup_required"
export type PointCommand = {matchId:string;gameNumber:number;side:"a"|"b";delta:1|-1;expectedVersion:number;operationId:string}

export function mergeLiveScores(current:LiveScores,updates:LiveScore[]):LiveScores {
  let next=current
  for(const score of updates) {
    if(current[score.match_id] && current[score.match_id].version>=score.version)continue
    if(next===current)next={...current}
    // A batch may itself contain reordered/duplicate updates.
    if(!next[score.match_id] || next[score.match_id].version<score.version)next[score.match_id]=score
  }
  return next
}

/** Subscribe first, then catch up from the database. A late read cannot reopen
 * controls after a disconnect, and old snapshots cannot replace newer events. */
export class LiveScoreSession {
  private epoch=0
  private channelUp=false
  private online=true
  private stopped=false
  private ready=false
  private fetching:Promise<boolean> | null=null
  constructor(private options:{fetch:()=>Promise<LiveScore[]>;onScores:(rows:LiveScore[])=>void;onState:(state:ScoreConnection)=>void}){}
  isReady=()=>this.ready && this.online && this.channelUp && !this.stopped
  private state(value:ScoreConnection){if(!this.stopped)this.options.onState(value)}
  receive(rows:LiveScore[]){if(!this.stopped)this.options.onScores(rows)}
  joined(){this.channelUp=true;return this.refresh()}
  disconnected(){this.epoch++;this.channelUp=false;this.ready=false;this.fetching=null;this.state(this.online ? "reconnecting":"offline")}
  setOnline(value:boolean){this.online=value;if(!value)this.disconnected();else{this.ready=false;this.state("reconnecting")}}
  setupRequired(){this.ready=false;this.state("setup_required")}
  refresh=():Promise<boolean>=>{
    if(this.stopped || !this.online)return Promise.resolve(false)
    if(this.fetching)return this.fetching
    const epoch=this.epoch
    this.ready=false;this.state("syncing")
    const task=this.options.fetch().then((rows)=>{
      if(this.stopped || epoch!==this.epoch)return false
      this.receive(rows);this.ready=this.channelUp && this.online
      this.state(this.ready ? "connected":"reconnecting")
      return this.ready
    }).catch((error)=>{
      if(this.stopped || epoch!==this.epoch)return false
      this.ready=false;this.state(error?.code==="PGRST205" || error?.code==="42P01" ? "setup_required":"reconnecting")
      return false
    }).finally(()=>{if(this.fetching===task)this.fetching=null})
    this.fetching=task;return task
  }
  stop(){this.stopped=true;this.ready=false;this.epoch++}
}

export async function withScoreTimeout<T>(request:Promise<T>,milliseconds=10000):Promise<T> {
  let timer:ReturnType<typeof setTimeout> | undefined
  try{return await Promise.race([request,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Score request timed out")),milliseconds)})])}
  finally{if(timer)clearTimeout(timer)}
}
