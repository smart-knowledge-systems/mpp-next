import type { Assignment } from "../model/Assignment.ts";
import type { Calendar } from "../model/Calendar.ts";
import { Duration } from "../model/Duration.ts";
import { createEmptyProject, type ProjectFile } from "../model/Project.ts";
import type { Relation } from "../model/Relation.ts";
import type { Resource } from "../model/Resource.ts";
import type { Task } from "../model/Task.ts";
import { RelationType, ResourceType, TimeUnit } from "../model/types.ts";
import { FixedData } from "./FixedData.ts";
import { FixedMeta } from "./FixedMeta.ts";
import { MppUtility } from "./MppUtility.ts";
import { Props } from "./Props.ts";
import { Var2Data } from "./Var2Data.ts";
import { VarMeta } from "./VarMeta.ts";
import type { MppVariant } from "./MppVariant.ts";

export interface MppStreamInfo {
  path: string;
  size: number;
}

export interface MppTableInspection {
  props: Props | null;
  fixedMeta: FixedMeta | null;
  varMeta: VarMeta | null;
  fixedDataSize: number;
  fixed2DataSize: number;
  var2DataSize: number;
}

export interface MppInspection {
  family: "modern";
  version: number;
  rootPath: string;
  formatPropsPath: string | null;
  projectPropsPath: string;
  streams: MppStreamInfo[];
  formatProps: Props | null;
  props14: Props | null;
  taskTable: MppTableInspection;
  resourceTable: MppTableInspection;
  assignmentTable: MppTableInspection;
  calendarTable: MppTableInspection;
}

export interface MppContainer {
  streams: Map<string, Uint8Array>;
}

interface TaskRecord {
  rawUniqueId: number;
  parentRawUniqueId: number | null;
  durationTenths: number | null;
  task: Task;
}

export class Mpp14Reader {
  constructor(
    private readonly container: MppContainer,
    private readonly variant: MppVariant,
  ) {}

  inspect(): MppInspection {
    const streams = Array.from(this.container.streams.entries()).map(([path, raw]) => ({
      path,
      size: raw.length,
    }));

    return {
      family: this.variant.family,
      version: this.variant.majorVersion,
      rootPath: this.variant.rootPath,
      formatPropsPath: this.variant.formatPropsPath,
      projectPropsPath: this.variant.projectPropsPath,
      streams,
      formatProps: this.variant.formatPropsPath
        ? this.readProps(this.variant.formatPropsPath)
        : null,
      get props14() {
        return this.formatProps;
      },
      taskTable: this.inspectTable(this.variant.taskTablePath),
      resourceTable: this.inspectTable(this.variant.resourceTablePath),
      assignmentTable: this.inspectTable(this.variant.assignmentTablePath),
      calendarTable: this.inspectTable(this.variant.calendarTablePath),
    };
  }

  read(): ProjectFile {
    const project = createEmptyProject();
    const projectProps = this.requireProps(this.variant.projectPropsPath);
    const summaryInformation = this.variant.summaryInformationPath
      ? Props.parseSummaryInformation(this.requireStream(this.variant.summaryInformationPath))
      : { title: null, author: null };

    project.properties = {
      ...project.properties,
      saveVersion: this.variant.majorVersion,
      title: summaryInformation.title,
      author: summaryInformation.author,
      startDate: projectProps.getTimestamp(PROJECT_START_DATE),
      finishDate: projectProps.getTimestamp(PROJECT_FINISH_DATE),
      statusDate: projectProps.getTimestamp(STATUS_DATE),
    };

    const resources = this.readResources();
    const resourceNames = new Map<number, string | null>(
      resources
        .filter((resource) => resource.uniqueId !== null)
        .map((resource) => [resource.uniqueId!, resource.name]),
    );
    const calendars = this.readCalendars(resourceNames);
    const taskRecords = this.readTasks(project.properties.finishDate);
    this.attachRelations(taskRecords);
    this.populateTaskHierarchy(taskRecords, project.properties.finishDate);

    project.tasks = taskRecords.map((record) => record.task).sort(compareTaskOrder);
    project.resources = resources.sort(compareResourceOrder);
    project.calendars = calendars.sort(compareCalendarOrder);
    project.assignments = this.readAssignments(
      new Set(taskRecords.map((record) => record.rawUniqueId)),
    );

    return project;
  }

  private inspectTable(prefix: string): MppTableInspection {
    return {
      props: this.readProps(`${prefix}/Props`),
      fixedMeta: this.readFixedMeta(`${prefix}/FixedMeta`, itemSizeForPrefix(prefix)),
      varMeta: this.readVarMeta(`${prefix}/VarMeta`),
      fixedDataSize: this.getSize(`${prefix}/FixedData`),
      fixed2DataSize: this.getSize(`${prefix}/Fixed2Data`),
      var2DataSize: this.getSize(`${prefix}/Var2Data`),
    };
  }

  private readTasks(projectFinish: Date | null): TaskRecord[] {
    const taskVarMeta = VarMeta.fromBuffer(this.requireStream(this.path("task", "VarMeta")));
    const taskVarData = Var2Data.fromMeta(
      taskVarMeta,
      this.requireStream(this.path("task", "Var2Data")),
    );
    const taskFixedMeta = FixedMeta.fromBuffer(
      this.requireStream(this.path("task", "FixedMeta")),
      47,
    );
    const taskFixedData = FixedData.fromMeta(
      taskFixedMeta,
      this.requireStream(this.path("task", "FixedData")),
      250,
    );
    const taskFixed2Meta = FixedMeta.fromBufferWithHeuristic(
      this.requireStream(this.path("task", "Fixed2Meta")),
      taskFixedData.count,
      [92, 93, 94, 95, 96],
    );
    const taskFixed2Data = FixedData.fromMeta(
      taskFixed2Meta,
      this.requireStream(this.path("task", "Fixed2Data")),
    );

    const taskMap = new Map<number, number | null>();
    for (let index = taskFixedMeta.adjustedItemCount - 1; index > 2; index -= 1) {
      const data = taskFixedData.getByteArrayValue(index);
      const data2 = taskFixed2Data.getByteArrayValue(index);
      const metaData = taskFixedMeta.getByteArrayValue(index);
      if (!data || !data2 || !metaData) {
        continue;
      }

      const flags = MppUtility.getInt(metaData, 0);
      if ((flags & 0x02) !== 0) {
        const deletedUniqueId = MppUtility.getShort(data, 0);
        if (!taskMap.has(deletedUniqueId)) {
          taskMap.set(deletedUniqueId, null);
        }
        continue;
      }

      if (data.length === NULL_TASK_BLOCK_SIZE) {
        const uniqueId = MppUtility.getInt(data, 0);
        if (!taskMap.has(uniqueId)) {
          taskMap.set(uniqueId, index);
        }
        continue;
      }

      const uniqueId = MppUtility.getInt(data, 4);
      const hasVarData = taskVarMeta.getTypes(uniqueId).size > 0;
      if (!taskMap.has(uniqueId) || hasVarData) {
        if (!taskMap.has(uniqueId) || (flags & 0x04) === 0) {
          taskMap.set(uniqueId, index);
        }
      }
    }

    const records: TaskRecord[] = [];

    for (const [rawUniqueId, index] of taskMap.entries()) {
      if (index === null) {
        continue;
      }

      const data = taskFixedData.getByteArrayValue(index);
      if (!data) {
        continue;
      }

      if (data.length === NULL_TASK_BLOCK_SIZE) {
        records.push({
          rawUniqueId,
          parentRawUniqueId: null,
          durationTenths: null,
          task: {
            id: nullIfZero(MppUtility.getInt(data, 4)),
            uniqueId: nullIfZero(MppUtility.getInt(data, 0)),
            name: null,
            wbs: null,
            outlineLevel: null,
            start: null,
            finish: null,
            duration: null,
            percentComplete: null,
            summary: false,
            milestone: false,
            critical: false,
            notes: null,
            priority: null,
            cost: null,
            work: null,
            actualWork: null,
            actualStart: null,
            actualFinish: null,
            baselineStart: null,
            baselineFinish: null,
            baselineDuration: null,
            constraintType: null,
            freeSlack: null,
            totalSlack: null,
            earlyStart: null,
            earlyFinish: null,
            lateStart: null,
            lateFinish: null,
            levelingDelay: null,
            deadline: null,
            splits: null,
            predecessors: [],
          },
        });
        continue;
      }

      const id = MppUtility.getInt(data, 0);
      const uniqueId = MppUtility.getInt(data, 4);
      const durationTenths = safeInt(data, 88);

      // Read scheduling fields from FixedData using FieldMap14 offsets
      const freeSlackTenths = safeInt(data, 24);
      const startSlackTenths = safeInt(data, 28);
      const finishSlackTenths = safeInt(data, 32);
      const totalSlackTenths = computeTotalSlack(startSlackTenths, finishSlackTenths);
      const levelingDelayTenths = safeInt(data, 58);
      const actualWorkRaw = safeDouble(data, 134);

      records.push({
        rawUniqueId,
        parentRawUniqueId: normalizeParent(safeInt(data, 142)),
        durationTenths,
        task: {
          id: nullIfZero(id),
          uniqueId: nullIfZero(uniqueId),
          name: taskVarData.getUnicodeStringById(uniqueId, 14),
          wbs: null,
          outlineLevel: safeShort(data, 172),
          start: MppUtility.getTimestampValue(data, 104) ?? MppUtility.getTimestampValue(data, 96),
          finish:
            MppUtility.getTimestampValue(data, 108) ?? MppUtility.getTimestampValue(data, 100),
          duration: MppUtility.durationFromTenthsOfMinutes(durationTenths, TimeUnit.Minutes),
          percentComplete: 0,
          summary: false,
          milestone: durationTenths === 0,
          critical:
            projectFinish !== null &&
            MppUtility.isSameMinute(MppUtility.getTimestampValue(data, 100), projectFinish),
          notes: taskVarData.getUnicodeStringById(uniqueId, 15),
          priority: safeShort(data, 78),
          cost: 0,
          work: Duration.from(0, TimeUnit.Hours),
          actualWork: workFromDouble(actualWorkRaw),
          actualStart: null,
          actualFinish: null,
          baselineStart: null,
          baselineFinish: null,
          baselineDuration: null,
          constraintType: null,
          freeSlack: MppUtility.durationFromTenthsOfMinutes(freeSlackTenths, TimeUnit.Minutes),
          totalSlack: MppUtility.durationFromTenthsOfMinutes(totalSlackTenths, TimeUnit.Minutes),
          earlyStart: MppUtility.getTimestampValue(data, 106),
          earlyFinish: MppUtility.getTimestampValue(data, 8),
          lateStart: MppUtility.getTimestampValue(data, 12),
          lateFinish: MppUtility.getTimestampValue(data, 110),
          levelingDelay: MppUtility.durationFromTenthsOfMinutes(
            levelingDelayTenths,
            TimeUnit.Minutes,
          ),
          deadline: MppUtility.getTimestampValue(data, 122),
          splits: null,
          predecessors: [],
        },
      });
    }

    return records;
  }

  private readResources(): Resource[] {
    const resourceVarMeta = VarMeta.fromBuffer(
      this.requireStream(this.path("resource", "VarMeta")),
    );
    const resourceVarData = Var2Data.fromMeta(
      resourceVarMeta,
      this.requireStream(this.path("resource", "Var2Data")),
    );
    const resourceFixedMeta = FixedMeta.fromBuffer(
      this.requireStream(this.path("resource", "FixedMeta")),
      37,
    );
    const resourceFixedData = FixedData.fromMeta(
      resourceFixedMeta,
      this.requireStream(this.path("resource", "FixedData")),
      220,
    );

    const resources: Resource[] = [
      {
        id: null,
        uniqueId: null,
        name: null,
        type: ResourceType.Work,
        email: null,
        group: null,
        maxUnits: 100,
        cost: 0,
        work: null,
        resourcePool: null,
      },
    ];

    for (let index = 0; index < resourceFixedData.count; index += 1) {
      const data = resourceFixedData.getByteArrayValue(index);
      if (!data || data.length < 8) {
        continue;
      }

      const id = MppUtility.getInt(data, 0);
      const uniqueId = MppUtility.getInt(data, 4);
      if (id <= 0 || uniqueId <= 0) {
        continue;
      }

      resources.push({
        id,
        uniqueId,
        name: resourceVarData.getUnicodeStringById(uniqueId, 1),
        type: ResourceType.Work,
        email: resourceVarData.getUnicodeStringById(uniqueId, 35),
        group: resourceVarData.getUnicodeStringById(uniqueId, 3),
        maxUnits: 100,
        cost: 0,
        work: null,
        resourcePool: null,
      });
    }

    return resources;
  }

  private readCalendars(resourceNames: Map<number, string | null>): Calendar[] {
    const calendarVarMeta = VarMeta.fromBuffer(
      this.requireStream(this.path("calendar", "VarMeta")),
    );
    const calendarVarData = Var2Data.fromMeta(
      calendarVarMeta,
      this.requireStream(this.path("calendar", "Var2Data")),
    );
    const calendarFixedMeta = FixedMeta.fromBuffer(
      this.requireStream(this.path("calendar", "FixedMeta")),
      10,
    );
    const calendarFixedData = FixedData.fromMeta(
      calendarFixedMeta,
      this.requireStream(this.path("calendar", "FixedData")),
      12,
      12,
    );

    const calendars = new Map<number, Calendar>();

    for (let index = 0; index < calendarFixedData.count; index += 1) {
      const data = calendarFixedData.getByteArrayValue(index);
      if (!data || data.length < 12) {
        continue;
      }

      for (let offset = 0; offset + 12 <= data.length; offset += 12) {
        const resourceId = MppUtility.getInt(data, offset + 4);
        const calendarId = MppUtility.getInt(data, offset + 8);
        if (calendarId <= 0 || calendars.has(calendarId)) {
          continue;
        }

        const name =
          calendarVarData.getUnicodeStringById(calendarId, 1) ??
          (resourceId > 0 ? (resourceNames.get(resourceId) ?? null) : "Unnamed Resource");

        calendars.set(calendarId, {
          uniqueId: calendarId,
          name,
          weekDays: [],
          exceptions: [],
        });
      }
    }

    return [...calendars.values()];
  }

  private readAssignments(taskIds: Set<number>): Assignment[] {
    const assignmentFixedMeta = FixedMeta.fromBuffer(
      this.requireStream(this.path("assignment", "FixedMeta")),
      34,
    );
    const assignmentFixedData = FixedData.fromFixedSize(
      this.requireStream(this.path("assignment", "FixedData")),
      110,
    );

    const assignments: Assignment[] = [];

    for (let index = 0; index < assignmentFixedMeta.adjustedItemCount; index += 1) {
      const metaData = assignmentFixedMeta.getByteArrayValue(index);
      if (!metaData || metaData[0] !== 0) {
        continue;
      }

      const offset = MppUtility.getInt(metaData, 4);
      const recordIndex = assignmentFixedData.getIndexFromOffset(offset);
      if (recordIndex === -1) {
        continue;
      }

      const data = assignmentFixedData.getByteArrayValue(recordIndex);
      if (!data || data.length < 60) {
        continue;
      }

      const taskUniqueId = MppUtility.getInt(data, 4);
      if (!taskIds.has(taskUniqueId)) {
        continue;
      }

      const start = MppUtility.getTimestampValue(data, 52);
      const finish = MppUtility.getTimestampValue(data, 56);
      const assignmentActualWorkRaw = safeDouble(data, 62);
      const assignmentRemainingWorkRaw = safeDouble(data, 78);
      assignments.push({
        taskUniqueId,
        resourceUniqueId: normalizeResourceId(MppUtility.getInt(data, 8)),
        work: elapsedHoursDuration(start, finish),
        units: 100,
        start,
        finish,
        actualWork: workFromDouble(assignmentActualWorkRaw),
        remainingWork: workFromDouble(assignmentRemainingWorkRaw),
      });
    }

    return assignments;
  }

  private attachRelations(taskRecords: TaskRecord[]): void {
    const relationFixedMeta = FixedMeta.fromBuffer(
      this.requireStream(this.path("relation", "FixedMeta")),
      10,
    );
    const relationFixedData = FixedData.fromFixedSize(
      this.requireStream(this.path("relation", "FixedData")),
      20,
    );
    const recordsByUniqueId = new Map<number, TaskRecord>(
      taskRecords.map((record) => [record.rawUniqueId, record]),
    );

    let lastConstraintId = -1;
    for (let index = 0; index < relationFixedMeta.adjustedItemCount; index += 1) {
      const metaData = relationFixedMeta.getByteArrayValue(index);
      if (!metaData || MppUtility.getShort(metaData, 0) !== 0) {
        continue;
      }

      const recordIndex = relationFixedData.getIndexFromOffset(MppUtility.getInt(metaData, 4));
      if (recordIndex === -1) {
        continue;
      }

      const data = relationFixedData.getByteArrayValue(recordIndex);
      if (!data || data.length < 14) {
        continue;
      }

      const constraintId = MppUtility.getInt(data, 0);
      if (constraintId <= lastConstraintId) {
        continue;
      }
      lastConstraintId = constraintId;

      const predecessorUniqueId = MppUtility.getInt(data, 4);
      const successorUniqueId = MppUtility.getInt(data, 8);
      if (predecessorUniqueId === successorUniqueId) {
        continue;
      }

      const successor = recordsByUniqueId.get(successorUniqueId);
      if (!successor || !recordsByUniqueId.has(predecessorUniqueId)) {
        continue;
      }

      const relation: Relation = {
        predecessorUniqueId,
        successorUniqueId,
        type: parseRelationType(MppUtility.getShort(data, 12)),
        lag: Duration.from(0, TimeUnit.Days),
      };
      successor.task.predecessors.push(relation);
    }
  }

  private populateTaskHierarchy(taskRecords: TaskRecord[], projectFinish: Date | null): void {
    const childrenByParent = new Map<number, TaskRecord[]>();
    for (const record of taskRecords) {
      if (record.parentRawUniqueId === null) {
        continue;
      }
      const siblings = childrenByParent.get(record.parentRawUniqueId) ?? [];
      siblings.push(record);
      childrenByParent.set(record.parentRawUniqueId, siblings);
    }

    taskRecords.sort((left, right) => compareTaskOrder(left.task, right.task));

    const counterByParent = new Map<number, number>();
    const wbsByUniqueId = new Map<number, string>();

    for (const record of taskRecords) {
      record.task.summary = childrenByParent.has(record.rawUniqueId);

      if (record.rawUniqueId === 0) {
        record.task.wbs = "0";
        wbsByUniqueId.set(record.rawUniqueId, "0");
      } else if (record.parentRawUniqueId === null) {
        record.task.wbs = null;
      } else {
        const nextIndex = (counterByParent.get(record.parentRawUniqueId) ?? 0) + 1;
        counterByParent.set(record.parentRawUniqueId, nextIndex);
        const parentWbs = wbsByUniqueId.get(record.parentRawUniqueId);
        record.task.wbs =
          parentWbs === "0" ? `${nextIndex}` : parentWbs ? `${parentWbs}.${nextIndex}` : null;
        if (record.task.wbs) {
          wbsByUniqueId.set(record.rawUniqueId, record.task.wbs);
        }
      }

      if (record.durationTenths !== null) {
        record.task.duration = MppUtility.durationFromTenthsOfMinutes(
          record.durationTenths,
          record.task.summary || record.durationTenths >= 4800 ? TimeUnit.Days : TimeUnit.Minutes,
        );
      }

      record.task.critical =
        projectFinish !== null &&
        MppUtility.isSameMinute(record.task.finish, projectFinish) &&
        (record.task.summary || !childrenByParent.has(record.rawUniqueId));
    }
  }

  private readProps(path: string): Props | null {
    const raw = this.container.streams.get(path);
    return raw ? Props.fromBuffer(raw) : null;
  }

  private readFixedMeta(path: string, itemSize: number): FixedMeta | null {
    const raw = this.container.streams.get(path);
    return raw ? FixedMeta.fromBuffer(raw, itemSize) : null;
  }

  private readVarMeta(path: string): VarMeta | null {
    const raw = this.container.streams.get(path);
    return raw ? VarMeta.fromBuffer(raw) : null;
  }

  private getSize(path: string): number {
    return this.container.streams.get(path)?.length ?? 0;
  }

  private requireStream(path: string): Uint8Array {
    const stream = this.container.streams.get(path);
    if (!stream) {
      throw new Error(`Missing stream: ${path}`);
    }
    return stream;
  }

  private requireProps(path: string): Props {
    const props = this.readProps(path);
    if (!props) {
      throw new Error(`Missing props stream: ${path}`);
    }
    return props;
  }

  private path(
    table: "task" | "resource" | "assignment" | "calendar" | "relation",
    leaf: string,
  ): string {
    switch (table) {
      case "task":
        return `${this.variant.taskTablePath}/${leaf}`;
      case "resource":
        return `${this.variant.resourceTablePath}/${leaf}`;
      case "assignment":
        return `${this.variant.assignmentTablePath}/${leaf}`;
      case "calendar":
        return `${this.variant.calendarTablePath}/${leaf}`;
      case "relation":
        return `${this.variant.relationTablePath}/${leaf}`;
    }
  }
}

function itemSizeForPrefix(prefix: string): number {
  if (prefix.endsWith("TBkndTask")) {
    return 47;
  }
  if (prefix.endsWith("TBkndRsc")) {
    return 37;
  }
  if (prefix.endsWith("TBkndAssn")) {
    return 34;
  }
  if (prefix.endsWith("TBkndCal")) {
    return 10;
  }
  return 10;
}

function compareTaskOrder(left: Task, right: Task): number {
  return (left.id ?? -1) - (right.id ?? -1);
}

function compareResourceOrder(left: Resource, right: Resource): number {
  return (left.id ?? -1) - (right.id ?? -1);
}

function compareCalendarOrder(left: Calendar, right: Calendar): number {
  return (left.uniqueId ?? -1) - (right.uniqueId ?? -1);
}

function nullIfZero(value: number): number | null {
  return value === 0 ? null : value;
}

function normalizeParent(value: number | null): number | null {
  return value === null || value < 0 ? null : value;
}

function normalizeResourceId(value: number): number | null {
  return value <= 0 || value === 65535 || value === -65535 ? null : value;
}

function safeShort(buffer: Uint8Array, offset: number): number | null {
  return offset + 2 <= buffer.length ? MppUtility.getUShort(buffer, offset) : null;
}

function safeInt(buffer: Uint8Array, offset: number): number | null {
  return offset + 4 <= buffer.length ? MppUtility.getInt(buffer, offset) : null;
}

function safeDouble(buffer: Uint8Array, offset: number): number | null {
  return offset + 8 <= buffer.length ? MppUtility.getDouble(buffer, offset) : null;
}

/**
 * Convert a raw work value (stored as 8-byte double in MPP) to a Duration in hours.
 * The stored value is in 1/60000ths of an hour (i.e., milliseconds of work).
 * Values with absolute magnitude less than 1000 are treated as zero.
 */
function workFromDouble(raw: number | null): Duration | null {
  if (raw === null) {
    return null;
  }
  const value = Math.abs(raw) < 1000 ? 0 : raw / 60000;
  return Duration.from(value, TimeUnit.Hours);
}

/**
 * Compute total slack as the minimum of start slack and finish slack.
 */
function computeTotalSlack(
  startSlackTenths: number | null,
  finishSlackTenths: number | null,
): number | null {
  if (startSlackTenths === null && finishSlackTenths === null) {
    return null;
  }
  if (startSlackTenths === null) {
    return finishSlackTenths;
  }
  if (finishSlackTenths === null) {
    return startSlackTenths;
  }
  return Math.min(startSlackTenths, finishSlackTenths);
}

function elapsedHoursDuration(start: Date | null, finish: Date | null): Duration | null {
  if (!start || !finish) {
    return null;
  }
  return Duration.from((finish.getTime() - start.getTime()) / 3_600_000, TimeUnit.Hours);
}

function parseRelationType(value: number): RelationType {
  switch (value) {
    case 0:
      return RelationType.FinishToFinish;
    case 1:
      return RelationType.FinishToStart;
    case 2:
      return RelationType.StartToFinish;
    case 3:
      return RelationType.StartToStart;
    default:
      return RelationType.FinishToStart;
  }
}

const PROJECT_START_DATE = 37748738;
const PROJECT_FINISH_DATE = 37748739;
const STATUS_DATE = 37748805;
const NULL_TASK_BLOCK_SIZE = 16;
