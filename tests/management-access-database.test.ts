import { PGlite } from "@electric-sql/pglite"
import { readFileSync,readdirSync } from "node:fs"
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from "vitest"
import { BACKUP_MANAGER_EMAIL } from "../lib/auth/backup-manager"

let db:PGlite
const id=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,"0")}`
const admin=id(1),mt=id(2),exco=id(3),player=id(4),backup=id(5),legacyMt=id(6),legacyAdmin=id(7)
async function actor(user:string){await db.exec("RESET ROLE");await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec("SET ROLE authenticated")}
async function denied(op:()=>Promise<unknown>){await db.exec("SAVEPOINT denied");try{await expect(op()).rejects.toMatchObject({code:"42501"})}finally{await db.exec("ROLLBACK TO SAVEPOINT denied; RELEASE SAVEPOINT denied")}}
async function profile(){return(await db.query<{is_admin:boolean;organizational_role:string}>("SELECT is_admin,organizational_role FROM public.current_actor_profile()")).rows[0]}
async function createTournament(){return(await db.query<{id:string}>("INSERT INTO public.tournaments(title,location,court_count,start_date,end_date) VALUES('Restored management','UMPSA',2,'2026-11-10','2026-11-11') RETURNING id")).rows[0].id}
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;GRANT USAGE ON SCHEMA auth TO authenticated,anon;
    CREATE TABLE auth.users(id UUID PRIMARY KEY,email TEXT,email_confirmed_at TIMESTAMPTZ,raw_user_meta_data JSONB DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE SQL STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::UUID $$;`)
  for(const file of readdirSync("supabase/migrations").filter((f)=>f.endsWith(".sql")).sort()){
    if(file==="20261108180005_restore_management_access.sql"){
      await db.exec("ALTER TABLE public.profiles ADD COLUMN role TEXT")
      for(const [user,role] of [[legacyMt,"mt"],[legacyAdmin,"Admin"]]){
        await db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)",[user,`${user}@adab.umpsa.edu.my`,JSON.stringify({full_name:role})])
        await db.query("UPDATE public.profiles SET role=$1 WHERE id=$2",[role,user])
      }
    }
    try{await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"))}catch(error){throw new Error(`Migration failed: ${file}`,{cause:error})}
  }
  for(let n=1;n<=5;n++)await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,now(),$3)",[id(n),n===5 ? BACKUP_MANAGER_EMAIL:`manager-${n}@adab.umpsa.edu.my`,JSON.stringify({full_name:`Manager ${n}`})])
  await db.query("UPDATE public.profiles SET is_admin=true WHERE id=$1",[admin]);await db.query("UPDATE public.profiles SET organizational_role='MT' WHERE id=$1",[mt]);await db.query("UPDATE public.profiles SET organizational_role='EXCO' WHERE id=$1",[exco])
},30000)
beforeEach(async()=>{await db.exec("RESET ROLE; BEGIN")});afterEach(async()=>{await db.exec("ROLLBACK; RESET ROLE")});afterAll(async()=>{await db?.close()})

describe("restored management authority",()=>{
  it.each([admin,mt,legacyMt,legacyAdmin])("lets approved high-level user %s create and read draft tournaments",async(user)=>{
    await actor(user);const tournament=await createTournament()
    expect((await db.query("SELECT id FROM public.tournaments WHERE id=$1",[tournament])).rows).toHaveLength(1)
  })
  it("supports approved profile roles when normalized role rows are missing",async()=>{
    await db.query("DELETE FROM public.user_roles WHERE user_id=$1 AND role_code='MT'",[mt])
    await actor(mt);expect(await profile()).toMatchObject({organizational_role:"MT"});await createTournament()
  })
  it("continues to support the older profile-based database while the role-table migration is pending",async()=>{
    await db.exec("DROP TABLE public.user_roles")
    await actor(mt);expect(await profile()).toMatchObject({organizational_role:"MT"});await createTournament()
  })
  it("recognizes approved global role-table grants without requiring a second profile flag",async()=>{
    await db.query("INSERT INTO public.user_roles(user_id,role_code,source) VALUES($1,'MT','PROFILE')",[player])
    await actor(player);expect(await profile()).toMatchObject({organizational_role:"MT"});await createTournament()
  })
  it("does not turn EXCO, players or editable signup metadata into MT",async()=>{
    await db.query("UPDATE auth.users SET raw_user_meta_data=$1 WHERE id=$2",[JSON.stringify({role:"Admin",organizational_role:"MT"}),player])
    for(const user of [exco,player]){await actor(user);expect((await profile()).is_admin).toBe(false);await denied(()=>createTournament())}
    await denied(()=>db.query("UPDATE public.profiles SET role='Admin' WHERE id=$1",[player]))
  })
  it("gives the exact verified backup manager full MT and role-approval access without permanently granting is_admin",async()=>{
    await actor(player);const request=(await db.query<{id:string}>("SELECT id FROM public.submit_organization_role_request('MT','President')")).rows[0].id
    await actor(backup);expect((await profile()).is_admin).toBe(true);await createTournament()
    await db.query("SELECT public.review_organization_role_request($1,true,'Verified leadership appointment')",[request])
    await db.exec("RESET ROLE")
    expect((await db.query<{is_admin:boolean}>("SELECT is_admin FROM public.profiles WHERE id=$1",[backup])).rows[0].is_admin).toBe(false)
    await actor(player);expect((await profile()).organizational_role).toBe("MT")
  })
  it("removes the bypass immediately on Auth email change and rejects spoofed or unverified email fields",async()=>{
    await db.query("UPDATE auth.users SET email='other@gmail.com' WHERE id=$1",[backup])
    await actor(backup);expect((await profile()).is_admin).toBe(false);await denied(()=>createTournament())
    await db.exec("RESET ROLE")
    await db.query("UPDATE public.profiles SET email='former-backup@umpsa.edu.my' WHERE id=$1",[backup])
    await db.query("UPDATE public.profiles SET email=$1 WHERE id=$2",[BACKUP_MANAGER_EMAIL,player])
    await actor(player);expect((await profile()).is_admin).toBe(false)
    await db.exec("RESET ROLE")
    await db.query("UPDATE auth.users SET email=$1,email_confirmed_at=NULL WHERE id=$2",[BACKUP_MANAGER_EMAIL,backup])
    await actor(backup);expect((await profile()).is_admin).toBe(false);await denied(()=>createTournament())
  })
  it("allows only the named Gmail address to register, with bypass withheld until Auth confirmation",async()=>{
    await db.query("UPDATE auth.users SET email='former-backup@umpsa.edu.my' WHERE id=$1",[backup])
    await db.query("UPDATE public.profiles SET email='former-backup@umpsa.edu.my' WHERE id=$1",[backup])
    await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES($1,$2,NULL,$3)",[id(8),BACKUP_MANAGER_EMAIL,JSON.stringify({full_name:"Pending backup",is_admin:true,role:"Admin"})])
    await actor(id(8));expect((await profile()).is_admin).toBe(false);await denied(()=>createTournament())
    await db.exec("RESET ROLE");await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",[id(8)])
    await actor(id(8));expect((await profile()).is_admin).toBe(true);await createTournament()
    await db.exec("RESET ROLE")
    await denied(()=>db.query("INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,'random@gmail.com','{}')",[id(9)]))
  })
})
