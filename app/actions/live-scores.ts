"use server"

import { z } from "zod"
import { requireAuthenticated } from "@/lib/auth/authorization"
import { apiError,apiSuccess,type ApiResponse } from "@/lib/apiResponse"
import { categoryEntries } from "@/lib/tournament/entries"
import { databaseReadFailure } from "@/lib/supabase/schema"
import { liveScoreSchema,type LiveScore } from "@/lib/realtime/live-scores"

export type PublishedGroup={id:string;category_id:string;name:string;players:Array<{id:string;name:string}>}
export type GroupPreviewData={groups:PublishedGroup[];scores:LiveScore[];liveAvailable:boolean}
export async function getGroupPreview(categoryIds:string[]):Promise<ApiResponse<GroupPreviewData>> {
  const auth=await requireAuthenticated()
  if(!auth.ok)return auth.response
  const input=z.array(z.string().uuid()).max(256).safeParse(categoryIds)
  if(!input.success)return apiError("VALIDATION_ERROR",400,"Choose valid tournament categories.")
  const ids=[...new Set(input.data)]
  if(!ids.length)return apiSuccess({groups:[],scores:[],liveAvailable:true})
  const [groups,scores,entries]=await Promise.all([
    auth.supabase.from("groups").select("id,category_id,name,members:group_members(player_id)").in("category_id",ids).order("name"),
    auth.supabase.from("live_match_scores").select("*").in("category_id",ids),
    categoryEntries(auth.supabase,ids),
  ])
  if(groups.error)return databaseReadFailure(groups.error)
  if(!entries.success)return entries
  const missing=scores.error && ["42P01","PGRST205"].includes(scores.error.code)
  if(scores.error && !missing)return databaseReadFailure(scores.error)
  const names=new Map(entries.data.map((e)=>[`${e.category_id}:${e.representative_id}`,e.display_name]))
  return apiSuccess({
    groups:(groups.data ?? []).map((g)=>({id:g.id,category_id:g.category_id,name:g.name,players:(g.members ?? []).map((m)=>({id:m.player_id,name:names.get(`${g.category_id}:${m.player_id}`) ?? "Player"}))})),
    scores:(scores.data ?? []).flatMap((s)=>{const parsed=liveScoreSchema.safeParse(s);return parsed.success ? [parsed.data]:[]}),liveAvailable:!missing,
  })
}
