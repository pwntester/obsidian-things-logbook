import { App } from "obsidian";
import { ISettings } from "./settings";
import { ISubTask, ITask } from "./things";
import { getHeadingLevel, getTab, groupBy } from "./textUtils";

export class LogbookRenderer {
  private app: App;
  private settings: ISettings;

  constructor(app: App, settings: ISettings) {
    this.app = app;
    this.settings = settings;
    this.renderTask = this.renderTask.bind(this);
    this.toHeading = this.toHeading.bind(this);
  }

  toHeading(title: string, level: number, indentLevel: number, addLink: boolean): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vault = this.app.vault as any;
    const tab = getTab(vault.getConfig("useTab"), vault.getConfig("tabSize"));
    let hash = "".padStart(level, "#") + " ";
    hash = "";
    const indentString = `${tab}`.repeat(indentLevel);
    const link = addLink ? `[[${title}]]` : title;
    return `${indentString}- ${hash}${link}`;
  }

  renderTask(task: ITask, indentLevel: number): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vault = this.app.vault as any;
    const tab = getTab(vault.getConfig("useTab"), vault.getConfig("tabSize"));
    const prefix = this.settings.tagPrefix;

    const tags = task.tags
      .filter((tag) => !!tag)
      .map((tag) => tag.replace(/\s+/g, "-").toLowerCase())
      .map((tag) => `#${prefix}${tag}`)
      .join(" ");

    const taskTitle = `${task.title} [link](things:///show?id=${task.uuid}) ${tags}`.trimEnd()

    const indentString = `${tab}`.repeat(indentLevel);
    const notes = this.settings.doesSyncNoteBody
      ? String(task.notes || "")
        .trimEnd()
        .split("\n")
        .filter((line) => !!line)
        .map((noteLine) => `${indentString}${tab}${noteLine}`)
      : ""

    return [
      `${indentString}- ${task.cancelled ? '[' + this.settings.canceledMark + '] ' : ''}${taskTitle}`,
      ...notes,
      ...task.subtasks.map(
        (subtask: ISubTask) =>
          `${indentString}${tab}- [${subtask.completed ? "x" : " "}] ${subtask.title}`
      ),
    ]
      .filter((line) => !!line)
      .join("\n");
  }

  public render(tasks: ITask[]): string {
    const { sectionHeading } = this.settings;
    const headingLevel = getHeadingLevel(sectionHeading);
    const indentLevel = 0;
    const output = [sectionHeading, ""];

    // Tasks with no area and no project
    const tasksWithoutAreaAndProject = tasks.filter((task) => (!task.area || task.area === "") && (!task.project || task.project === ""));
    tasksWithoutAreaAndProject.forEach((task) => {
      if (task.title !== "Morning routine") {
        output.push(this.renderTask(task, indentLevel));
      }
    });

    // Tasks with no area, but with project
    const tasksWithProjectButNoArea = tasks.filter((task) => (!task.area || task.area === "") && task.project && task.project !== "");
    const tasksWithProjectButNoAreaGroupedByProject = groupBy<ITask>(tasksWithProjectButNoArea, (task) => task.project);
    Object.entries(tasksWithProjectButNoAreaGroupedByProject).map(([project, tasks]) => {
      output.push(this.toHeading(project, headingLevel + 1, indentLevel, true));

      // tasks with no area, project and no heading
      const tasksWithNoAreaButWithProjectAndNoHeader = tasks.filter((task) => !task.heading || task.heading === "");
      tasksWithNoAreaButWithProjectAndNoHeader.forEach((task) => {
        output.push(this.renderTask(task, indentLevel + 1));
      });
      // render tasks with no area, project and heading
      const tasksWithNoAreaButWithProjectAndHeader = tasks.filter((task) => task.heading && task.heading !== "");
      const tasksWithNoAreaAndProjectAndHeading = groupBy<ITask>(tasksWithNoAreaButWithProjectAndHeader, (task) => task.heading);
      Object.entries(tasksWithNoAreaAndProjectAndHeading).map(([heading, tasks]) => {
        output.push(this.toHeading(heading, headingLevel + 2, indentLevel + 1, true));
        tasks.forEach((task) => {
          output.push(this.renderTask(task, indentLevel + 2));
        });
      });
    });

    // Tasks with area
    const tasksWithArea = tasks.filter((task) => (task.area && task.area !== ""));
    const tasksWithAreaGrouped = groupBy<ITask>(tasksWithArea, (task) => task.area)
    Object.entries(tasksWithAreaGrouped).map(([area, tasks]) => {
      output.push(this.toHeading(area, headingLevel + 1, indentLevel, false));

      // tasks with area but no project 
      const tasksWithAreaButNoProject = tasks.filter((task) => !task.project || task.project === "");
      tasksWithAreaButNoProject.forEach((task) => {
        output.push(this.renderTask(task, indentLevel + 1));
      });

      // Tasks with area, and project
      const tasksWithAreaAndProject = tasks.filter((task) => task.project && task.project !== "");
      const tasksWithAreaAndProjectGroupedByProject = groupBy<ITask>(tasksWithAreaAndProject, (task) => task.project);
      Object.entries(tasksWithAreaAndProjectGroupedByProject).map(([project, tasks]) => {
        output.push(this.toHeading(project, headingLevel + 2, indentLevel + 1, true));
        // tasks with area, project and no heading
        const tasksWithAreaAndProjectButNoHeading = tasks.filter((task) => !task.heading || task.heading === "");
        tasksWithAreaAndProjectButNoHeading.forEach((task) => {
          if (task.title !== "Morning routine") {
            output.push(this.renderTask(task, indentLevel + 2));
          }
        });

        // Tasks with area, project and heading
        const tasksWithAreaAndProjectAndHeading = tasks.filter((task) => task.heading && task.heading !== "");
        const tasksWithAreaAndProjectAndHeadingGroupedByHeading = groupBy<ITask>(tasksWithAreaAndProjectAndHeading, (task) => task.heading);
        Object.entries(tasksWithAreaAndProjectAndHeadingGroupedByHeading).map(([heading, tasks]) => {
          output.push(this.toHeading(heading, headingLevel + 3, indentLevel + 2, false));
          tasks.forEach((task) => {
            output.push(this.renderTask(task, indentLevel + 3));
          });
        });
      });
    });

    return output.join("\n");
  }
}
