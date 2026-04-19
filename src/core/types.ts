import { z } from "zod";

export const StatusEnum = z.enum([
  "todo",
  "doing",
  "done",
  "blocked",
  "cancelled",
]);
export type Status = z.infer<typeof StatusEnum>;

export const PriorityEnum = z.enum(["low", "med", "high", "urgent"]);
export type Priority = z.infer<typeof PriorityEnum>;

export const NoteKindEnum = z.enum([
  "attempt",
  "blocker",
  "insight",
  "comment",
]);
export type NoteKind = z.infer<typeof NoteKindEnum>;

const slug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, "must be lowercase slug");

export const ProjectCreateInput = z.object({
  id: slug,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});

export const TaskCreateInput = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional(),
  projectId: slug.optional(),
  status: StatusEnum.optional(),
  priority: PriorityEnum.optional(),
  dueAt: z.coerce.date().optional(),
  plan: z.string().max(20000).optional(),
  context: z.string().max(20000).optional(),
  labels: z.array(z.string()).optional(),
});

export const TaskUpdateInput = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).nullable().optional(),
  projectId: slug.nullable().optional(),
  priority: PriorityEnum.optional(),
  dueAt: z.coerce.date().nullable().optional(),
  plan: z.string().max(20000).nullable().optional(),
  context: z.string().max(20000).nullable().optional(),
});

export const TaskListFilter = z.object({
  status: z.union([StatusEnum, z.array(StatusEnum)]).optional(),
  projectId: slug.optional(),
  priority: PriorityEnum.optional(),
  label: z.string().optional(),
  dueBefore: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(500).default(100).optional(),
});

export const SetStatusInput = z.object({
  status: StatusEnum,
  reason: z.string().max(1000).optional(),
});

export const AddNoteInput = z.object({
  body: z.string().min(1).max(20000),
  kind: NoteKindEnum.default("comment"),
});

export const SearchInput = z.object({
  q: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(100).default(20).optional(),
});

export const LabelCreateInput = z.object({
  name: z.string().min(1).max(64),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});
