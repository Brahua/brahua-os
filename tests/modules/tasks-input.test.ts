// T1: the Zod schemas of `tasks` (shared by the capture form, the detail and the actions).
import { describe, expect, test } from "vitest";
import {
  createTaskInputSchema,
  editTaskInputSchema,
  isInInbox,
  TASK_ERRORS,
  taskIdInputSchema,
} from "@/modules/tasks/task-input";

const AREA = "00000000-0000-4000-8000-0000000000a1";
const PROJECT = "00000000-0000-4000-8000-0000000000b1";
const MILESTONE = "00000000-0000-4000-8000-0000000000c1";
const TASK = "00000000-0000-4000-8000-0000000000d1";

const messages = (result: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => [issue.path.join("."), issue.message]) ?? [];

describe("createTaskInputSchema", () => {
  test("a title alone is an inbox task with Media priority and no date", () => {
    expect(createTaskInputSchema.parse({ title: "comprar pilas" })).toEqual({
      title: "comprar pilas",
      lifeAreaId: null,
      projectId: null,
      milestoneId: null,
      dueDate: null,
      priority: "medium",
    });
  });

  test("the title is normalized like names (NFC, whitespace collapsed, trimmed)", () => {
    expect(createTaskInputSchema.parse({ title: "  regar \n las\tplantas " }).title).toBe(
      "regar las plantas",
    );
    expect(createTaskInputSchema.parse({ title: "Café" }).title).toBe("Café");
  });

  test("empty, too long or with invisible characters is a title error", () => {
    expect(messages(createTaskInputSchema.safeParse({ title: "   " }))).toEqual([
      ["title", TASK_ERRORS.titleRequired],
    ]);
    expect(messages(createTaskInputSchema.safeParse({}))).toEqual([
      ["title", TASK_ERRORS.titleRequired],
    ]);
    expect(messages(createTaskInputSchema.safeParse({ title: "a".repeat(201) }))).toEqual([
      ["title", TASK_ERRORS.titleTooLong],
    ]);
    expect(createTaskInputSchema.safeParse({ title: "a".repeat(200) }).success).toBe(true);
    expect(messages(createTaskInputSchema.safeParse({ title: "pilas​" }))).toEqual([
      ["title", TASK_ERRORS.titleInvisible],
    ]);
  });

  test("an area or a project (with a milestone), never both; '' means none", () => {
    expect(createTaskInputSchema.parse({ title: "x", lifeAreaId: AREA, projectId: "" })).toMatchObject(
      { lifeAreaId: AREA, projectId: null },
    );
    expect(
      createTaskInputSchema.parse({ title: "x", projectId: PROJECT, milestoneId: MILESTONE }),
    ).toMatchObject({ projectId: PROJECT, milestoneId: MILESTONE, lifeAreaId: null });
    expect(
      messages(createTaskInputSchema.safeParse({ title: "x", lifeAreaId: AREA, projectId: PROJECT })),
    ).toEqual([["projectId", TASK_ERRORS.areaAndProject]]);
    expect(
      messages(createTaskInputSchema.safeParse({ title: "x", milestoneId: MILESTONE })),
    ).toEqual([["milestoneId", TASK_ERRORS.milestoneWithoutProject]]);
    expect(messages(createTaskInputSchema.safeParse({ title: "x", lifeAreaId: "salud" }))).toEqual([
      ["lifeAreaId", TASK_ERRORS.area],
    ]);
  });

  test("the due date is a real day; '' clears it", () => {
    expect(createTaskInputSchema.parse({ title: "x", dueDate: "2026-10-31" }).dueDate).toBe(
      "2026-10-31",
    );
    expect(createTaskInputSchema.parse({ title: "x", dueDate: "" }).dueDate).toBeNull();
    for (const dueDate of ["2026-02-30", "31/10/2026", "2026-10-31T00:00:00Z"]) {
      expect(messages(createTaskInputSchema.safeParse({ title: "x", dueDate }))).toEqual([
        ["dueDate", TASK_ERRORS.dateInvalid],
      ]);
    }
  });

  test("priority is one of the three", () => {
    expect(createTaskInputSchema.parse({ title: "x", priority: "high" }).priority).toBe("high");
    expect(messages(createTaskInputSchema.safeParse({ title: "x", priority: "urgent" }))).toEqual([
      ["priority", TASK_ERRORS.priority],
    ]);
  });

  test("unknown fields (done_at, deleted_at, is_next_action…) are dropped", () => {
    const parsed = createTaskInputSchema.parse({
      title: "x",
      doneAt: "2026-01-01",
      isNextAction: true,
      id: TASK,
    });
    expect(parsed).not.toHaveProperty("doneAt");
    expect(parsed).not.toHaveProperty("isNextAction");
    expect(parsed).not.toHaveProperty("id");
  });
});

describe("editTaskInputSchema", () => {
  test("what is missing stays as it is (undefined); null clears the date", () => {
    expect(editTaskInputSchema.parse({ id: TASK })).toEqual({ id: TASK });
    expect(editTaskInputSchema.parse({ id: TASK, dueDate: null })).toEqual({
      id: TASK,
      dueDate: null,
    });
    expect(editTaskInputSchema.parse({ id: TASK, dueDate: "" })).toEqual({ id: TASK, dueDate: null });
  });

  test("a placement is complete: missing fields mean none, and the rules apply", () => {
    expect(editTaskInputSchema.parse({ id: TASK, placement: { lifeAreaId: AREA } })).toEqual({
      id: TASK,
      placement: { lifeAreaId: AREA, projectId: null, milestoneId: null },
    });
    expect(
      messages(
        editTaskInputSchema.safeParse({
          id: TASK,
          placement: { lifeAreaId: AREA, projectId: PROJECT },
        }),
      ),
    ).toEqual([["placement.projectId", TASK_ERRORS.areaAndProject]]);
  });

  test("the id must be a uuid", () => {
    expect(messages(editTaskInputSchema.safeParse({ id: "1" }))).toEqual([
      ["id", TASK_ERRORS.notFound],
    ]);
    expect(messages(taskIdInputSchema.safeParse({ id: "' or 1=1" }))).toEqual([
      ["id", TASK_ERRORS.notFound],
    ]);
  });
});

test("isInInbox: neither an area nor a project", () => {
  expect(isInInbox({ lifeAreaId: null, projectId: null })).toBe(true);
  expect(isInInbox({ lifeAreaId: AREA, projectId: null })).toBe(false);
  expect(isInInbox({ lifeAreaId: null, projectId: PROJECT })).toBe(false);
});
