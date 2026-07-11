"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle } from "lucide-react";
import type { ProjectSummary } from "@/lib/types";
import { useProjectStore } from "@/store/projects";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

export interface ProjectFormProps {
  open: boolean;
  /** When set, the form edits this project; otherwise it creates a new one. */
  project: ProjectSummary | null;
  onClose: () => void;
}

export function ProjectForm({ open, project, onClose }: ProjectFormProps) {
  const create = useProjectStore((s) => s.create);
  const update = useProjectStore((s) => s.update);
  const saving = useProjectStore((s) => s.saving);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const isEdit = !!project;

  // Reset field state whenever the modal opens (create) or targets a project.
  useEffect(() => {
    if (!open) return;
    setLocalError(null);
    if (project) {
      setName(project.name);
      setDescription(project.description ?? "");
      setInstructions(project.instructions ?? "");
    } else {
      setName("");
      setDescription("");
      setInstructions("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project]);

  const canSubmit = name.trim().length > 0 && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setLocalError(null);

    const trimmedName = name.trim();
    const desc = description.trim();
    const inst = instructions.trim();

    const result = project
      ? await update(project.id, {
          name: trimmedName,
          description: desc || null,
          instructions: inst || null,
        })
      : await create({
          name: trimmedName,
          description: desc || undefined,
          instructions: inst || undefined,
        });

    if (result) {
      onClose();
    } else {
      setLocalError(
        useProjectStore.getState().error || "Failed to save project",
      );
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? "Edit project" : "New project"}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Marketing site"
            className={inputClass}
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What is this project about?"
            className={cn(inputClass, "resize-y")}
          />
        </Field>

        <Field label="Instructions">
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            placeholder="How should the assistant behave in this project?"
            className={cn(inputClass, "resize-y")}
          />
          <span className="text-xs text-text-secondary">
            Added to the system prompt for every chat in this project.
          </span>
        </Field>

        {localError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <AlertCircle size={15} className="shrink-0" />
            <span className="min-w-0 flex-1">{localError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit} loading={saving}>
            {isEdit ? "Save changes" : "Create project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const inputClass =
  "w-full rounded-lg border border-border bg-main px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-text-secondary focus:outline-none";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  );
}

export default ProjectForm;
