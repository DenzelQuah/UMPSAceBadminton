"use client"

import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { useRouter, useSearchParams } from "next/navigation"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form"
import { toast } from "@/components/ui/toast"
import { loginWithDomain, loginWithTestPersona, registerWithDomain } from "@/app/actions/auth"
import { safeRedirectPath,isUmpEmail } from "@/lib/auth/validation"
import { isBackupManagerEmail } from "@/lib/auth/backup-manager"
import { TEST_PERSONAS, type TestPersona } from "@/lib/test-personas"
import { ORGANIZATIONAL_ROLES, ROLE_DETAILS, ROLE_LABELS } from "@/lib/auth/organizational-roles"

const authSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  fullName: z.string().optional(),
  matricNumber: z.string().optional(),
  requestedRole: z.enum(ORGANIZATIONAL_ROLES),
  roleDetail: z.string().max(100).optional(),
})

type AuthFormValues = z.infer<typeof authSchema>

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = safeRedirectPath(searchParams.get("redirect_to"))

  const [mode, setMode] = React.useState<"login" | "register">("login")
  const [loading, setLoading] = React.useState(false)
  const [testPersonaLoading, setTestPersonaLoading] = React.useState<TestPersona | null>(null)
  const testAuthEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_TEST_AUTH_MODE === "true"

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      email: "",
      password: "",
      fullName: "",
      matricNumber: "",
      requestedRole: "PLAYER",
      roleDetail: "",
    },
  })

  const { handleSubmit, control } = form
  const emailValue = useWatch({ control, name: "email" })
  const requestedRole = useWatch({ control, name: "requestedRole" })
  const showDomainWarning = React.useMemo(() => {
    if (!emailValue) return false
    const emailParsed = z.string().email().safeParse(emailValue)
    if (!emailParsed.success) return false
    return !isUmpEmail(emailValue) && !isBackupManagerEmail(emailValue)
  }, [emailValue])

  const onSubmit = async (values: AuthFormValues) => {
    setLoading(true)

    try {
      if (mode === "login") {
        const response = await loginWithDomain({
          email: values.email,
          password: values.password,
          provider: "email",
        })

        if (!response.success) {
          toast.add({
            title: "Login Failed",
            description: response.error.message,
            type: "error",
          })
        } else {
          toast.add({
            title: "Success",
            description: "Successfully logged in!",
            type: "success",
          })
          router.push(redirectTo)
          router.refresh()
        }
      } else {
        if (!values.fullName) {
          toast.add({
            title: "Missing Information",
            description: "Full name is required for registration.",
            type: "warning",
          })
          setLoading(false)
          return
        }

        const response = await registerWithDomain({
          email: values.email,
          password: values.password,
          fullName: values.fullName,
          matricNumber: values.matricNumber,
          requestedRole: values.requestedRole,
          roleDetail: values.roleDetail,
        })

        if (!response.success) {
          toast.add({
            title: "Registration Failed",
            description: response.error.message,
            type: "error",
          })
        } else {
          toast.add({
            title: "Account Created",
            description: response.data.requiresEmailConfirmation ? "Check your email to verify your account, then sign in. Organization roles require administrator approval." : "Your account is ready. Organization role requests remain pending until an administrator approves them.",
            type: "success",
          })
          if (response.data.requiresEmailConfirmation) setMode("login")
          else { router.push(redirectTo); router.refresh() }
        }
      }
    } catch (error) {
      toast.add({
        title: "Error",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        type: "error",
      })
    } finally {
      setLoading(false)
    }
  }

  const loginAsTestPersona = async (persona: (typeof TEST_PERSONAS)[number]) => {
    setTestPersonaLoading(persona.id)
    try {
      const response = await loginWithTestPersona({ persona: persona.id })
      if (!response.success) {
        toast.add({
          title: "Test persona unavailable",
          description: response.error.message,
          type: "error",
        })
        return
      }

      toast.add({
        title: `Signed in to ${persona.label} test account`,
        description: "Your approved organization role determines workspace access. Test labels do not grant permissions.",
        type: "success",
      })
      router.push("/dashboard")
      router.refresh()
    } catch (error) {
      toast.add({
        title: "Test persona error",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
        type: "error",
      })
    } finally {
      setTestPersonaLoading(null)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-background p-4 sm:p-6 lg:p-8">
      <Card className="w-full max-w-md border shadow-lg">
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-center mb-2">
            <span className="text-2xl font-extrabold tracking-tight text-primary">
              UMPSAce Badminton
            </span>
          </div>
          <CardTitle className="text-center text-xl font-bold">
            {mode === "login" ? "Sign In to Your Account" : "Register a New Account"}
          </CardTitle>
          <CardDescription className="text-center text-sm leading-6">
            {mode === "login"
              ? "One account for playing, officiating and tournament administration. Choose your workspace after signing in."
              : "Create your UMPSA account. Request MT, EXCO or AJK access for administrator approval, or join as a player."}
          </CardDescription>
        </CardHeader>
        <CardContent className="[&_input]:min-h-12 [&_input]:rounded-xl [&_input]:border-slate-300 [&_input]:bg-white [&_input]:text-slate-900">
          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {mode === "register" && (
                <>
                  <FormField
                    control={control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter your full name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={control}
                    name="matricNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Matric / Staff Number</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. AA20000" {...field} />
                        </FormControl>
                        <FormDescription>
                          Optional. Required for student/staff classification.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {mode === "register" && <>
                <FormField control={control} name="requestedRole" render={({ field }) => <FormItem><FormLabel>Register as</FormLabel><FormControl><select {...field} onChange={(event) => { field.onChange(event); form.setValue("roleDetail", "") }} className="min-h-12 w-full rounded-lg border bg-white px-3 text-sm">{ORGANIZATIONAL_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></FormControl><FormDescription>MT, EXCO and AJK requests stay pending until administrator approval. You can participate as a player meanwhile.</FormDescription><FormMessage /></FormItem>} />
                {requestedRole !== "PLAYER" && <FormField control={control} name="roleDetail" render={({ field }) => <FormItem><FormLabel>Position / team</FormLabel><FormControl><select {...field} required className="min-h-12 w-full rounded-lg border bg-white px-3 text-sm"><option value="">Choose your position or team</option>{ROLE_DETAILS[requestedRole].map((detail) => <option key={detail} value={detail}>{detail}</option>)}</select></FormControl><FormMessage /></FormItem>} />}
              </>}
              <FormField
                control={control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Institutional Email</FormLabel>
                    <FormControl>
                      <Input placeholder="username@adab.umpsa.edu.my" {...field} />
                    </FormControl>
                    {showDomainWarning && (
                      <p className="text-xs font-semibold text-amber-600 dark:text-amber-500 mt-1">
                        ⚠️ Warning: UMPSAce requires a @adab.umpsa.edu.my or @umpsa.edu.my institutional email.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={loading || testPersonaLoading!==null}
                className="mt-6 min-h-12 w-full rounded-xl bg-[#0b3c5d] text-white transition-colors hover:bg-[#134e70]"
              >
                {loading ? "Please wait..." : mode === "login" ? "Sign In" : "Register"}
              </Button>
            </form>
          </Form>
          {testAuthEnabled && (
            <details className="mt-6 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid="test-persona-switcher">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">Development test accounts</summary>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Development test personas</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    Disposable accounts for the full player, official, and committee flow. This panel is disabled in production.
                  </p>
                </div>
                <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                  Test only
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TEST_PERSONAS.map((persona) => (
                  <Button
                    key={persona.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-10 text-xs"
                    disabled={loading || testPersonaLoading !== null}
                    onClick={() => void loginAsTestPersona(persona)}
                  >
                    {testPersonaLoading === persona.id ? "Signing in…" : persona.label}
                  </Button>
                ))}
              </div>
            </details>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-4 border-t pt-4">
          <div className="text-sm text-center text-muted-foreground">
            {mode === "login" ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  disabled={loading || testPersonaLoading!==null}
                  onClick={() => {
                    setMode("register")
                    form.reset({
                      email: "",
                      password: "",
                      fullName: "",
                      matricNumber: "",
                      requestedRole: "PLAYER",
                      roleDetail: "",
                    })
                  }}
                  className="min-h-11 cursor-pointer rounded px-1 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                  Register here
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  disabled={loading || testPersonaLoading!==null}
                  onClick={() => {
                    setMode("login")
                    form.reset({
                      email: "",
                      password: "",
                      fullName: "",
                      matricNumber: "",
                      requestedRole: "PLAYER",
                      roleDetail: "",
                    })
                  }}
                  className="min-h-11 cursor-pointer rounded px-1 font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                  Sign in here
                </button>
              </>
            )}
          </div>
        </CardFooter>
      </Card>
    </main>
  )
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={<div className="flex min-h-screen items-center justify-center">Loading...</div>}>
      <LoginContent />
    </React.Suspense>
  )
}
