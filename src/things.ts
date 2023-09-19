import * as os from "os";
import * as fs from "fs";
import * as path from "path";

import { THINGS_DB_PATH_START, THINGS_DB_PATH_END } from "./constants";
import { querySqliteDB } from "./sqlite";

export const TASK_FETCH_LIMIT = 1000;
export const PROJECT_FETCH_LIMIT = 1000;
export const HEADING_FETCH_LIMIT = 1000;

export interface ISubTask {
  completed: boolean;
  title: string;
}

export interface ITask {
  uuid: string;
  title: string;
  notes: string;
  area?: string;
  project?: string;
  heading?: string;
  tags: string[];
  startDate: number;
  stopDate: number;
  cancelled: boolean;
  subtasks: ISubTask[];
}

export interface ITaskRecord {
  uuid: string;
  title?: string;
  notes: string;
  area?: string;
  project?: string;
  heading?: string;
  startDate: number;
  stopDate: number;
  status: string;
  tag?: string;
}

export interface ITaskRecord {
  uuid: string;
  title?: string;
  notes: string;
  area?: string;
  project?: string;
  heading?: string;
  startDate: number;
  stopDate: number;
  status: string;
  tag?: string;
}

export interface IHeadingRecord {
  uuid: string;
  title?: string;
  area?: string;
  project?: string;
}

export interface IProjectRecord {
  uuid: string;
  title?: string;
  area?: string;
}

export interface IChecklistItemRecord {
  uuid: string;
  taskId: string;
  title: string;
  startDate: number;
  stopDate: number;
}

const baseDir = THINGS_DB_PATH_START.replace("~", os.homedir());
const dataPath = fs.readdirSync(baseDir).filter((file) => file.startsWith("ThingsData"))[0];
const thingsSqlitePath = path.join(baseDir, dataPath, THINGS_DB_PATH_END);

export class ThingsSQLiteSyncError extends Error { }


const STATUS_CANCELLED = 2;

export function buildTasksFromSQLRecords(
  taskRecords: ITaskRecord[],
  checklistRecords: IChecklistItemRecord[],
  projectRecords: IProjectRecord[],
  headingRecords: IHeadingRecord[]
): ITask[] {
  const tasks: Record<string, ITask> = {};
  taskRecords.forEach(({ tag, ...task }) => {
    const id = task.uuid;
    let { area, project, heading } = task;
    const { status, title, ...other } = task;

    if (heading) {
      const headingRecord = headingRecords.find((h) => h.uuid === heading);
      if (headingRecord) {
        heading = headingRecord.title;
        if (headingRecord.area) {
          area = headingRecord.area;
        }
        if (headingRecord.project) {
          const projectRecord = projectRecords.find((p) => p.uuid === headingRecord.project);
          if (projectRecord) {
            project = projectRecord.title;
            if (projectRecord.area) {
              area = projectRecord.area;
            }
          }
        }
      }
    }

    if (project) {
      const projectRecord = projectRecords.find((p) => p.uuid === project);
      if (projectRecord) {
        project = projectRecord.title;
        if (projectRecord.area) {
          area = projectRecord.area;
        }
      }
    }

    if (tasks[id]) {
      tasks[id].tags.push(tag);
    } else {
      tasks[id] = {
        ...other,
        area,
        project,
        heading,
        cancelled: STATUS_CANCELLED === Number.parseInt(status),
        title: (title || "").trimEnd(),
        subtasks: [],
        tags: [tag],
      };
    }
  });

  checklistRecords.forEach(({ taskId, title, stopDate }) => {
    const task = tasks[taskId];
    const subtask = {
      completed: !!stopDate,
      title: title.trimEnd(),
    };

    // checklist item might be completed before task
    if (task) {
      if (task.subtasks) {
        task.subtasks.push(subtask);
      } else {
        task.subtasks = [subtask];
      }
    }
  });

  return Object.values(tasks);
}

async function getProjectsFromThingsDb(): Promise<IProjectRecord[]> {
  return querySqliteDB<IProjectRecord>(
    thingsSqlitePath,
    `SELECT
        TMTask.uuid as uuid,
        TMTask.title as title,
        TMArea.title as area
    FROM
        TMTask
    LEFT JOIN TMArea
        ON TMTask.area = TMArea.uuid
    WHERE
        TMTask.type = 1 
    LIMIT ${PROJECT_FETCH_LIMIT}
        `
  );
}

async function getHeadingsFromThingsDb(): Promise<IHeadingRecord[]> {
  return querySqliteDB<IHeadingRecord>(
    thingsSqlitePath,
    `SELECT
        TMTask.uuid as uuid,
        TMTask.title as title,
        TMArea.title as area,
        TMProject.uuid as project
    FROM
        TMTask
    LEFT JOIN TMArea
        ON TMTask.area = TMArea.uuid
    LEFT JOIN TMTask TMProject
        ON TMProject.uuid = TMTask.project
    WHERE
        TMTask.type = 2
    LIMIT ${PROJECT_FETCH_LIMIT}
        `
  );
}

async function getTasksFromThingsDb(
  latestSyncTime: number
): Promise<ITaskRecord[]> {
  return querySqliteDB<ITaskRecord>(
    thingsSqlitePath,
    `SELECT
        TMTask.uuid as uuid,
        TMTask.title as title,
        TMTask.notes as notes,
        TMTask.startDate as startDate,
        TMTask.stopDate as stopDate,
        TMTask.status as status,
        TMTag.title as tag,
        TMArea.title as area,
        TMProject.uuid as project,
        TMHeading.uuid as heading
    FROM
        TMTask
    LEFT JOIN TMTaskTag
        ON TMTaskTag.tasks = TMTask.uuid
    LEFT JOIN TMTag
        ON TMTag.uuid = TMTaskTag.tags
    LEFT JOIN TMArea
        ON TMTask.area = TMArea.uuid
    LEFT JOIN TMTask TMProject
        ON TMProject.uuid = TMTask.project
    LEFT JOIN TMTask TMHeading
        ON TMHeading.uuid = TMTask.heading
    WHERE
        TMTask.type = 0
        AND TMTask.trashed = 0
        AND TMTask.stopDate IS NOT NULL
        AND TMTask.stopDate > ${latestSyncTime}
    ORDER BY
        TMTask.stopDate
    LIMIT ${TASK_FETCH_LIMIT}
        `
  );
}

async function getChecklistItemsThingsDb(
  latestSyncTime: number
): Promise<IChecklistItemRecord[]> {
  return querySqliteDB<IChecklistItemRecord>(
    thingsSqlitePath,
    `SELECT
        task as taskId,
        title as title,
        stopDate as stopDate
    FROM
        TMChecklistItem
    WHERE
        title IS NOT ""
        AND stopDate > ${latestSyncTime}
    ORDER BY
        stopDate
    LIMIT ${TASK_FETCH_LIMIT}
        `
  );
}

export async function getTasksFromThingsLogbook(
  latestSyncTime: number
): Promise<ITaskRecord[]> {
  const taskRecords: ITaskRecord[] = [];
  let isSyncCompleted = false;
  let stopTime = window.moment.unix(latestSyncTime).startOf("day").unix();

  try {
    while (!isSyncCompleted) {
      console.debug("[Things Logbook] fetching tasks from sqlite db...");

      const batch = await getTasksFromThingsDb(stopTime);

      isSyncCompleted = batch.length < TASK_FETCH_LIMIT;
      stopTime = batch.filter((t) => t.stopDate).last()?.stopDate;

      taskRecords.push(...batch);
      console.debug(
        `[Things Logbook] fetched ${batch.length} tasks from sqlite db`
      );
    }
  } catch (err) {
    console.error("[Things Logbook] Failed to query the Things SQLite DB", err);
    throw new ThingsSQLiteSyncError("fetch Tasks failed");
  }

  return taskRecords;
}

export async function getChecklistItemsFromThingsLogbook(
  latestSyncTime: number
): Promise<IChecklistItemRecord[]> {
  const checklistItems: IChecklistItemRecord[] = [];
  let isSyncCompleted = false;
  let stopTime = latestSyncTime;

  try {
    while (!isSyncCompleted) {
      console.debug(
        "[Things Logbook] fetching checklist items from sqlite db..."
      );

      const batch = await getChecklistItemsThingsDb(stopTime);

      isSyncCompleted = batch.length < TASK_FETCH_LIMIT;
      stopTime = batch.filter((t) => t.stopDate).last()?.stopDate;

      checklistItems.push(...batch);
      console.debug(
        `[Things Logbook] fetched ${batch.length} checklist items from sqlite db`
      );
    }
  } catch (err) {
    console.error("[Things Logbook] Failed to query the Things SQLite DB", err);
    throw new ThingsSQLiteSyncError("fetch Subtasks failed");
  }

  return checklistItems;
}

export async function getProjectsFromThingsLogbook(): Promise<IProjectRecord[]> {
  const projects: IProjectRecord[] = [];
  let isSyncCompleted = false;

  try {
    while (!isSyncCompleted) {
      console.debug(
        "[Things Logbook] fetching projects from sqlite db..."
      );

      const batch = await getProjectsFromThingsDb();

      isSyncCompleted = batch.length < PROJECT_FETCH_LIMIT;

      projects.push(...batch);
      console.debug(
        `[Things Logbook] fetched ${batch.length} projects from sqlite db`
      );
    }
  } catch (err) {
    console.error("[Things Logbook] Failed to query the Things SQLite DB", err);
    throw new ThingsSQLiteSyncError("fetch Subtasks failed");
  }

  return projects;
}

export async function getHeadingsFromThingLogbook(): Promise<IProjectRecord[]> {
  const headings: IHeadingRecord[] = [];
  let isSyncCompleted = false;

  try {
    while (!isSyncCompleted) {
      console.debug(
        "[Things Logbook] fetching headings from sqlite db..."
      );

      const batch = await getHeadingsFromThingsDb();

      isSyncCompleted = batch.length < HEADING_FETCH_LIMIT;

      headings.push(...batch);
      console.debug(
        `[Things Logbook] fetched ${batch.length} headings from sqlite db`
      );
    }
  } catch (err) {
    console.error("[Things Logbook] Failed to query the Things SQLite DB", err);
    throw new ThingsSQLiteSyncError("fetch Subtasks failed");
  }

  return headings;
}
