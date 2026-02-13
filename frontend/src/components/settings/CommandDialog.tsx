import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  subtask: z.boolean(),
  topP: z.number().min(0).max(1).optional(),
});

type CommandFormValues = z.infer<typeof commandFormSchema>;

interface Command {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
  topP?: number;
}

interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, command: Command) => void;
  editingCommand?: { name: string; command: Command } | null;
}

export function CommandDialog({
  open,
  onOpenChange,
  onSubmit,
  editingCommand,
}: CommandDialogProps) {
  const form = useForm<CommandFormValues>({
    resolver: zodResolver(commandFormSchema),
    defaultValues: {
      name: editingCommand?.name || "",
      template: editingCommand?.command.template || "",
      description: editingCommand?.command.description || "",
      agent: editingCommand?.command.agent || "",
      model: editingCommand?.command.model || "",
      subtask: editingCommand?.command.subtask || false,
      topP: editingCommand?.command.topP ?? 1,
    },
  });

  const handleSubmit = (values: CommandFormValues) => {
    const command: Command = {
      template: values.template,
      description: values.description || undefined,
      agent: values.agent || undefined,
      model: values.model || undefined,
      subtask: values.subtask || undefined,
      topP: values.topP || undefined,
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
      <DialogContent className="max-w-3xl max-h-[90vh] sm:max-h-[85vh] gap-0 flex flex-col p-0 md:p-6">
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

              <div className="flex flex-wrap sm:grid grid-cols-3 gap-4">
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
                  name="topP"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Top P (optional)</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          onChange={(e) =>
                            field.onChange(parseFloat(e.target.value))
                          }
                        />
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
                name="subtask"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">Run as subtask</FormLabel>
                      <FormDescription>
                        Execute this command as a separate subtask
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

        <DialogFooter className="p-3 sm:p-4 border-t gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => form.handleSubmit(handleSubmit)()} disabled={!form.formState.isValid}>
            {editingCommand ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

