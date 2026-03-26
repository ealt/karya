import type { FilterAliasValue, Priority, UserType } from "../../core/schema.js";

export interface ExpandedFilterAlias {
  project?: string[];
  priority?: Priority[];
  tag?: string[];
  owner?: string;
  assignee?: string;
  assigneeType?: UserType;
}

export function expandFilterAlias(aliasValue: FilterAliasValue, currentAuthor: string): ExpandedFilterAlias {
  return {
    project: aliasValue.project ? [aliasValue.project] : undefined,
    priority: aliasValue.priority ? [aliasValue.priority] : undefined,
    tag: aliasValue.tag ? [aliasValue.tag] : undefined,
    owner: aliasValue.owner === "me" ? currentAuthor : aliasValue.owner,
    assignee: aliasValue.assignee === "me" ? currentAuthor : aliasValue.assignee,
    assigneeType: aliasValue.assigneeType,
  };
}
