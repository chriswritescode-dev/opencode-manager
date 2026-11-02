import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { configModelRef, formatOpenCodeModelRef } from "@opencode-manager/shared/opencode";
import type { OpenCodeCommandConfig } from "@opencode-manager/shared/opencode";
import type { OpenCodeCommandPatch } from "@/api/types/settings";

const commandFormSchema = z.object({
  name: z
    .string()
    .min(1, "Command name is required")
    .regex(
      /^[a-z0-9-]+$/,
      "Must be lowercase letters, numbers, and hyphens only",
    ),
  template: z.string().min(1, "Template is required"),
  description: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  subagent: z.boolean(),
});

type CommandFormValues = z.infer<typeof commandFormSchema>;

interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, command: OpenCodeCommandPatch) => void;
  editingCommand?: { name: string; command: OpenCodeCommandConfig } | null;
}

export function CommandDialog({
  open,
  onOpenChange,
  onSubmit,
  editingCommand,
}: CommandDialogProps) {
  const getDefaultValues = (
    command?: { name: string; command: OpenCodeCommandConfig } | null,
  ): CommandFormValues => {
    const modelRef = configModelRef(command?.command.model);
    return {
      name: command?.name || "",
      template: command?.command.template || "",
      description: command?.command.description || "",
      agent: command?.command.agent || "",
      model: modelRef ? formatOpenCodeModelRef(modelRef) : "",
      subagent: command?.command.subagent || false,
    };
  };

  const form = useForm<CommandFormValues>({
    resolver: zodResolver(commandFormSchema),
    defaultValues: getDefaultValues(editingCommand),
  });

  useEffect(() => {
    if (open) {
      form.reset(getDefaultValues(editingCommand));
    }
  }, [open, editingCommand, form]);

  const handleSubmit = (values: CommandFormValues) => {
    const command: OpenCodeCommandPatch = {
      ...editingCommand?.command,
      template: values.template,
      description: values.description || null,
      agent: values.agent || null,
      model: values.model?.trim() || null,
      subagent: values.subagent ? true : null,
    };

    onSubmit(values.name, command);
    form.reset();
    onOpenChange(false);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      form.reset();
    }
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent mobileFullscreen className="sm:max-w-3xl sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
        <DialogHeader className="p-4 sm:p-6 border-b flex flex-row items-center justify-between space-y-0">
          <DialogTitle>
            {editingCommand ? "Edit Command" : "Create Command"}
          </DialogTitle>
        </DialogHeader>

        <div className="p-2 flex-1 overflow-y-auto sm:p-4">
          <Form {...form}>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Command Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="my-command"
                        disabled={!!editingCommand}
                        className={editingCommand ? "bg-muted" : ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Use lowercase letters, numbers, and hyphens only
                    </FormDescription>
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
                      <Textarea
                        {...field}
                        placeholder="Brief description of what the command does"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="template"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="The prompt template that will be sent to the LLM. Use $ARGUMENTS or $1, $2, etc. for parameters."
                        rows={8}
                        className="font-mono md:text-sm"
                      />
                    </FormControl>
                    <FormDescription>
                      Use $ARGUMENTS for all arguments or $1, $2, etc. for
                      specific parameters
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="agent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Agent (optional)</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="build" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model (optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder="anthropic/claude-3-5-sonnet-20241022"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="subagent"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Run as subagent</FormLabel>
                      <FormDescription>
                        Execute this command in a subagent session
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </Form>
        </div>

        <DialogFooter className="p-3 sm:p-4 border-t gap-2 pb-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <Button onClick={() => form.handleSubmit(handleSubmit)()} disabled={!form.formState.isValid} className="flex-1 sm:flex-none">
            {editingCommand ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
