"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plus, Trophy } from "lucide-react"
import { z } from "zod"
import { useRouter } from "next/navigation"

import { createTournament } from "@/app/actions/tournaments"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"

const tournamentFormSchema = z
  .object({
    title: z.string().trim().min(3, "Enter at least 3 characters."),
    description: z.string().trim().max(3000).optional(),
    location: z.string().trim().min(2, "Enter the venue name."),
    court_count: z.number().int().min(1).max(100),
    start_date: z.string().min(1, "Choose a start date and time."),
    end_date: z.string().min(1, "Choose an end date and time."),
  })
  .refine((data) => new Date(data.start_date) <= new Date(data.end_date), {
    message: "End date must be on or after the start date.",
    path: ["end_date"],
  })

type TournamentFormValues = z.infer<typeof tournamentFormSchema>

export function CreateTournamentDialog() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const form = useForm<TournamentFormValues>({
    resolver: zodResolver(tournamentFormSchema),
    defaultValues: {
      title: "",
      description: "",
      location: "UMPSA Sports Complex",
      court_count: 6,
      start_date: "",
      end_date: "",
    },
  })

  const onSubmit = async (values: TournamentFormValues) => {
    setSubmitting(true)
    try {
      const response = await createTournament({
        ...values,
        start_date: new Date(values.start_date).toISOString(),
        end_date: new Date(values.end_date).toISOString(),
      })

      if (!response.success) {
        toast.add({
          title: "Tournament not created",
          description: response.error.message,
          type: "error",
        })
        return
      }

      toast.add({
        title: "Tournament draft created",
        description: `${response.data.title} is ready for categories and scheduling.`,
        type: "success",
      })
      setOpen(false)
      form.reset()
      router.push(`/admin/tournaments/${response.data.id}`)
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="min-h-12 shrink-0 gap-2 px-5 font-semibold shadow-sm">
            <Plus className="size-4" aria-hidden="true" />
            New tournament
          </Button>
        }
      >
        New tournament
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Create tournament draft</DialogTitle>
          <DialogDescription>
            Start with the event basics. Categories and draw settings are added next.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 pt-2">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tournament name</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      placeholder="e.g. UMPSA Open Championship 2026"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      placeholder="Optional event summary for players and officials"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Venue</FormLabel>
                    <FormControl>
                      <Input className="min-h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="court_count"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Available courts</FormLabel>
                    <FormControl>
                      <Input
                        className="min-h-11"
                        type="number"
                        min={1}
                        max={100}
                        {...field}
                        onChange={(event) =>
                          field.onChange(event.target.value === "" ? 0 : Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormDescription>Used later to prevent invalid court assignments.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="start_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starts</FormLabel>
                    <FormControl>
                      <Input className="min-h-11" type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="end_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ends</FormLabel>
                    <FormControl>
                      <Input className="min-h-11" type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-950">
              <div className="flex items-start gap-3">
                <Trophy className="mt-0.5 size-5 shrink-0 text-blue-700" aria-hidden="true" />
                <div>
                  <p className="font-semibold">Safe draft workflow</p>
                  <p className="mt-1 leading-relaxed text-blue-900">
                    Creating a tournament does not open player registration or publish a draw.
                    You will review each stage before it becomes official.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={submitting}>
                {submitting ? "Creating draft…" : "Create tournament"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
