"use client"

import * as React from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Plus } from "lucide-react"
import { z } from "zod"

import { createCategory } from "@/app/actions/categories"
import { GAME_TYPES, GAME_TYPE_IDS, getGameType } from "@/lib/tournament/category-types"
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

const categorySchema = z
  .object({
    gameType: z.enum(GAME_TYPE_IDS),
    format: z.enum(["STANDARD_3X21", "SINGLE_SET_1X30"]),
    maxCapacity: z.number().int().min(4).max(1000),
    targetGroupSize: z.number().int().min(2).max(1000),
    drawFormat: z.enum(["ROUND_ROBIN","SINGLE_ELIMINATION"]),
    qualifiersPerGroup: z.number().int().min(1).max(64),
  })
  .refine((data) => data.maxCapacity >= data.qualifiersPerGroup, {
    message: "Capacity must be at least the qualifier count.",
    path: ["maxCapacity"],
  })
  .refine(
    (data) => data.qualifiersPerGroup <= data.maxCapacity,
    {
      message: "Qualifiers cannot exceed the available places per group.",
      path: ["qualifiersPerGroup"],
    }
  )

type CategoryValues = z.infer<typeof categorySchema>

export function AddCategoryDialog({
  tournamentId,
  onCreated,
  doublesAvailable = true,
}: {
  tournamentId: string
  onCreated: () => void | Promise<void>
  doublesAvailable?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      gameType: "MEN_SINGLES",
      format: "STANDARD_3X21",
      maxCapacity: 16,
      targetGroupSize: 4,
      drawFormat: "ROUND_ROBIN",
      qualifiersPerGroup: 1,
    },
  })

  const selectedGameType = useWatch({ control: form.control, name: "gameType" })
  const selectedType = getGameType(selectedGameType)
  const drawFormat = useWatch({ control:form.control,name:"drawFormat" })

  const submit = async (values: CategoryValues) => {
    setSaving(true)
    try {
      const response = await createCategory({ tournamentId, ...values })
      if (!response.success) {
        toast.add({
          title: "Category not created",
          description: response.error.message,
          type: "error",
        })
        return
      }

      toast.add({
        title: "Category added",
        description: `${response.data.name} is saved as a draft.`,
        type: "success",
      })
      setOpen(false)
      form.reset()
      await onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button className="min-h-11 gap-2">
            <Plus className="size-4" aria-hidden="true" />
            Add category
          </Button>
        }
      >
        Add category
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Add tournament category</DialogTitle>
          <DialogDescription>
            Each category keeps its own roster, draw, matches, and standings.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-5 pt-2">
            <FormField
              control={form.control}
              name="gameType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Game type</FormLabel>
                  <FormControl>
                    <select {...field} className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">
                      {GAME_TYPES.map((type) => <option key={type.id} value={type.id} disabled={type.participationFormat === null || (type.participationFormat === "DOUBLES" && !doublesAvailable)}>
                        {type.label}{type.participationFormat === null ? " — coming soon" : type.participationFormat === "DOUBLES" && !doublesAvailable ? " (database update needed)" : ""}
                      </option>)}
                    </select>
                  </FormControl>
                  <FormDescription>
                    {selectedType.participationFormat === "SINGLES" ? "One player per entry." : "Two players per entry. Partner consent is required, with at most one main-squad player per pair."} 3 v 3 is listed for now; team registration is not enabled.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="format"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Scoring format</FormLabel>
                  <select
                    {...field}
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none transition focus:border-blue-600 focus:ring-3 focus:ring-blue-100"
                  >
                    <option value="STANDARD_3X21">Best of three games to 21</option>
                    <option value="SINGLE_SET_1X30">Single game to 30</option>
                  </select>
                  <FormDescription>Keeps scoring rules configuration-driven.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField control={form.control} name="drawFormat" render={({ field }) => <FormItem><FormLabel>Tournament format</FormLabel><FormControl><select {...field} className="min-h-12 w-full rounded-lg border bg-white px-3"><option value="ROUND_ROBIN">Round-robin groups</option><option value="SINGLE_ELIMINATION">Single elimination</option></select></FormControl><FormDescription>The draw uses the final confirmed entry count after registration closes. Elimination byes are selected randomly.</FormDescription><FormMessage /></FormItem>} />
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="maxCapacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum entries (players or pairs)</FormLabel>
                    <FormControl>
                      <Input
                        className="min-h-11"
                        type="number"
                        min={4}
                        {...field}
                        onChange={(event) =>
                          field.onChange(event.target.value === "" ? 0 : Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="targetGroupSize"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Target entries per group</FormLabel>
                    <FormControl>
                      <Input
                        className="min-h-11"
                        type="number"
                        min={2}
                        disabled={drawFormat === "SINGLE_ELIMINATION"}
                        {...field}
                        onChange={(event) =>
                          field.onChange(event.target.value === "" ? 0 : Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="qualifiersPerGroup"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Qualifiers per group</FormLabel>
                  <FormControl>
                    <Input
                      className="min-h-11"
                      type="number"
                      min={1}
                      disabled={drawFormat === "SINGLE_ELIMINATION"}
                      {...field}
                      onChange={(event) =>
                        field.onChange(event.target.value === "" ? 0 : Number(event.target.value))
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    Group count is automatic. Groups stay balanced with at least two entries; qualifier places are capped to the actual group size. Group settings are unused for single elimination.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={saving}>
                {saving ? "Adding…" : "Add draft category"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
