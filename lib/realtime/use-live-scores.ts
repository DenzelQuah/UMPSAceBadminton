"use client"

import { useCallback,useEffect,useMemo,useRef,useState } from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase/client"
import { LiveScoreSession,liveScoreSchema,mergeLiveScores,withScoreTimeout,type LiveScore,type LiveScores,type ScoreConnection } from "./live-scores"

const EMPTY:LiveScore[]=[]
export function useLiveScores(categoryId:string,initial:LiveScore[]=EMPTY,matchId?:string,onDrawChange?:()=>void) {
  const [scores,setScores]=useState<LiveScores>(()=>mergeLiveScores({},initial))
  const [connection,setConnection]=useState<ScoreConnection>("connecting")
  const sessionRef=useRef<LiveScoreSession | null>(null)
  const reconnectRef=useRef<()=>void>(()=>{})
  const drawRef=useRef(onDrawChange)
  useEffect(()=>{drawRef.current=onDrawChange},[onDrawChange])
  const visibleScores=useMemo(()=>mergeLiveScores(scores,initial),[scores,initial])
  useEffect(()=>{
    let disposed=false,channel:RealtimeChannel | null=null,joinEpoch=0
    const session=new LiveScoreSession({
      fetch:async()=>{
        let query=supabase.from("live_match_scores").select("*").eq("category_id",categoryId)
        if(matchId)query=query.eq("match_id",matchId)
        const {data,error}=await withScoreTimeout(Promise.resolve(query))
        if(error)throw error
        return (data ?? []).flatMap((row)=>{const parsed=liveScoreSchema.safeParse(row);return parsed.success ? [parsed.data]:[]})
      },
      onScores:(rows)=>{if(!disposed)setScores((current)=>mergeLiveScores(current,rows))},
      onState:(state)=>{if(!disposed)setConnection(state)},
    })
    sessionRef.current=session
    const join=async()=>{
      const epoch=++joinEpoch
      session.disconnected()
      const old=channel;channel=null
      if(old)await supabase.removeChannel(old)
      if(disposed || !navigator.onLine || epoch!==joinEpoch)return
      try{
        await supabase.realtime.setAuth()
        if(disposed || epoch!==joinEpoch)return
        channel=supabase.channel(`scores:category:${categoryId}`,{config:{private:true}})
          .on("broadcast",{event:"score_changed"},({payload})=>{
            if(disposed || epoch!==joinEpoch)return
            const parsed=liveScoreSchema.safeParse(payload)
            if(parsed.success && parsed.data.category_id===categoryId && (!matchId || parsed.data.match_id===matchId))session.receive([parsed.data])
          })
          .on("broadcast",{event:"draw_changed"},()=>{if(!disposed && epoch===joinEpoch)drawRef.current?.()})
          .subscribe((status)=>{
            if(disposed || epoch!==joinEpoch)return
            if(status==="SUBSCRIBED")void session.joined()
            else if(status==="CHANNEL_ERROR" || status==="TIMED_OUT" || status==="CLOSED")session.disconnected()
          })
        void session.refresh()
      }catch{if(!disposed && epoch===joinEpoch)session.disconnected()}
    }
    reconnectRef.current=()=>{void join()}
    const offline=()=>{session.setOnline(false);joinEpoch++;if(channel){void supabase.removeChannel(channel);channel=null}}
    const online=()=>{session.setOnline(true);void join()}
    const catchUp=()=>{if(document.visibilityState==="visible" && navigator.onLine)void session.refresh()}
    window.addEventListener("offline",offline);window.addEventListener("online",online)
    window.addEventListener("focus",catchUp);document.addEventListener("visibilitychange",catchUp)
    // No reads while healthy. A slow safety catch-up remains if Realtime fails.
    const fallback=window.setInterval(()=>{if(!session.isReady()){if(!channel || channel.state==="closed")void join();else catchUp()}},30000)
    if(navigator.onLine)void join();else session.setOnline(false)
    return()=>{disposed=true;joinEpoch++;session.stop();sessionRef.current=null;reconnectRef.current=()=>{};window.clearInterval(fallback);window.removeEventListener("offline",offline);window.removeEventListener("online",online);window.removeEventListener("focus",catchUp);document.removeEventListener("visibilitychange",catchUp);if(channel)void supabase.removeChannel(channel)}
  },[categoryId,matchId])
  const isReady=useCallback(()=>sessionRef.current?.isReady()===true,[])
  const accept=useCallback((rows:LiveScore[])=>sessionRef.current?.receive(rows),[])
  const resync=useCallback(()=>sessionRef.current?.refresh() ?? Promise.resolve(false),[])
  const disconnect=useCallback(()=>sessionRef.current?.disconnected(),[])
  const reconnect=useCallback(()=>reconnectRef.current(),[])
  return {scores:visibleScores,connection,isReady,accept,resync,disconnect,reconnect}
}
